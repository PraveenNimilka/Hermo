import test from 'node:test';
import assert from 'node:assert/strict';

for(const source of ['panel','popup'])test(`${source} Stop while a command panel refresh is pending never issues that website command`,{timeout:5000},async()=>{
  const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch;
  let listener,running,release,operations=0,activeTabId=7,tabURL='https://synthetic.example/chat';const panels=[],sessionValues={},alarms=new Map();let sessionAccessLevel;
  const runningStarted=new Promise(resolve=>running=resolve),gate=new Promise(resolve=>release=resolve);
  const extensionId='a'.repeat(32),website='https://synthetic.example';
  globalThis.chrome={
    runtime:{id:extensionId,getURL:path=>'chrome-extension://'+extensionId+'/'+path,onMessage:{addListener:value=>listener=value},getContexts:async()=>[],sendMessage:async()=>({ok:true,state:'live'})},
    tabCapture:{getMediaStreamId:async()=> 'synthetic-stream'},offscreen:{createDocument:async()=>{},closeDocument:async()=>{}},
    storage:{local:{get:async()=>({browserContext:'bc_synthetic'}),set:async()=>{}},session:{
      setAccessLevel:async value=>{sessionAccessLevel=value.accessLevel;},
      get:async key=>({[key]:sessionValues[key]}),
      set:async values=>{Object.assign(sessionValues,structuredClone(values));}
    }},
    alarms:{get:async name=>alarms.get(name),create:async(name,value)=>{alarms.set(name,value);},clear:async name=>alarms.delete(name),onAlarm:{addListener:()=>{}}},
    tabs:{get:async()=>({id:7,url:tabURL,title:'Synthetic',incognito:false,active:true}),query:async()=>[{id:activeTabId}],onRemoved:{addListener:()=>{}},onUpdated:{addListener:()=>{}}},
    scripting:{executeScript:async({func,args})=>{
      if(func.name==='renderPanel'){
        panels.push(args[0]);if(args[0].state==='running'){running();await gate;}return [{result:true}];
      }
      if(func.name==='operateDocument'){operations++;return [{result:true}];}
      if(func.name==='func')return [{result:{width:1280,height:720}}];
      return [{result:{elements:[{kind:'output',read_mode:'last',selector:'#response',preview:'Synthetic response'}]}}];
    }}};
  globalThis.fetch=async url=>{
    if(url.endsWith('/pair'))return Response.json({token:'hb_session_synthetic',path_prefix:'/',app_name:'Synthetic app'});
    if(url.endsWith('/poll'))return Response.json({type:'command',id:'one-click',origin:website,path_prefix:'/',connection_status:'connected',expires_at:Date.now()+15000,command:{op:'operate',kind:'click',selector:'#send'}});
    if(url.endsWith('/disconnect'))return Response.json({ok:true});
    throw Error('Unexpected endpoint '+url);
  };
  try{
    await import(`../companion/browser/background.mjs?stop-race-${source}`);
    const pairResult=await new Promise(resolve=>listener({type:'hermo.pair',workspace:'http://127.0.0.1:4318',origin:website,tabId:7,code:'hb_pair_'+'a'.repeat(43),authorized:true},{id:extensionId,url:'chrome-extension://'+extensionId+'/popup.html'},resolve));
    assert.equal(pairResult.ok,true);await runningStarted;
    const activePanel=panels.find(p=>p.state==='running');
    const popupSender={id:extensionId,url:'chrome-extension://'+extensionId+'/popup.html'};
    const send=message=>new Promise(resolve=>listener(message,popupSender,resolve));
    const previewStarted=await send({type:'hermo.preview.start',tabId:7});
    assert.equal(previewStarted.ok,true,previewStarted.error);assert.equal(previewStarted.state,'live');assert.equal(previewStarted.connection_state,'running');assert.equal(previewStarted.connection_name,'Synthetic app');
    assert.deepEqual(Object.keys(previewStarted).sort(),['ok','state','expires_at','connection_state','connection_name'].sort(),'Start reply exposes only preview timing and safe connection metadata');
    await send({type:'hermo.preview.stop',tabId:7});
    for(const type of ['hermo.preview.status','hermo.preview.stop']){
      const result=await send({type,tabId:7});
      assert.deepEqual(result,{ok:true,state:'disabled',connection_state:'running',connection_name:'Synthetic app'},'Popup receives connection state without session authority');
    }
    if(source==='popup'){
      for(const sender of [{...popupSender,id:'b'.repeat(32)},{...popupSender,url:website+'/chat'},{...popupSender,url:popupSender.url+'?forged=1'},{...popupSender,tab:{id:7}}]){
        let responded=false;
        assert.equal(listener({type:'hermo.popup.stop',tabId:7},sender,()=>{responded=true;}),undefined,'Forged sender is rejected before asynchronous work');
        assert.equal(responded,false);
      }
      assert.deepEqual(await send({type:'hermo.popup.stop',tabId:8}),{ok:false},'Unconnected tab cannot stop another connection');
      activeTabId=8;
      assert.deepEqual(await send({type:'hermo.popup.stop',tabId:7}),{ok:false},'Popup can only stop its selected tab');
      assert.equal(globalThis.hermoConnectionStates[7].state,'running');activeTabId=7;
      tabURL='https://unrelated.example/';
      assert.deepEqual(await send({type:'hermo.popup.stop',tabId:7}),{ok:false},'Out-of-scope navigation cannot be controlled through the popup');tabURL=website+'/chat';
    }
    const stopped=source==='popup'?await send({type:'hermo.popup.stop',tabId:7}):await new Promise(resolve=>listener({type:'hermo.panel.stop',controller:activePanel.controller},{id:extensionId,tab:{id:7},url:website+'/chat'},resolve));
    assert.equal(stopped.ok,true);release();await new Promise(done=>setImmediate(done));
    assert.equal(operations,0,'Stop occurred before the click could be issued');
    assert.equal(globalThis.hermoConnectionStates[7].state,'stopped');
    assert.equal(panels.at(-1).state,'stopped');assert.ok(panels.at(-1).generation>activePanel.generation,'the pending older panel cannot override Stop');
    assert.equal(sessionAccessLevel,'TRUSTED_CONTEXTS');
    assert.deepEqual(sessionValues.hermoScopedBrowserSessions,[],'Stop clears persisted session authority');
    assert.equal(alarms.has('hermo.connection.recover'),false,'a stopped final connection has no recovery alarm');
  }finally{release();globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;}
});
