import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright';
import {installConnectedBrowser} from '../server/connected-browser.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await pause(20);}assert.fail('Expected companion state did not settle');}

async function fixture(t){
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4496,state=await createApp({port,dataDir:resolve('work/companion-cancellation',randomBytes(6).toString('hex')),browserEngineFactory:async()=>({close:async()=>{},closeAll:async()=>{},closeStudios:async()=>{}})});
  t.after(()=>state.app.close());
  let cookie='',csrf='';
  const call=async(path,body,headers={})=>{
    const response=await state.app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,'x-hermo-csrf':csrf,...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-cancellation-owner-password'})).csrf;
  const {db,seal,unseal}=state.store,at=new Date().toISOString();
  const connection={url:state.origin+'/sandbox/',checkpoint:state.origin+'/sandbox/',origins:[state.origin],access:'public',browser_mode:'connected',identity:{kind:'selected_tab',origin:state.origin}};
  db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('website','Shared fixture',connection.url,'connected',seal(connection),at);
  const keys={};
  for(const name of ['first','sibling']){
    const definition={version:name,effect:'recorded_browser_actions',inputs:{},steps:[{op:'click',selector:'#'+name}],outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'nonempty',output:'result'}],timeout_ms:15000};
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(name,'website',name,'fixture.'+name,'published',name,seal(definition),name,at);
    const secret='hm_live_'+randomBytes(32).toString('base64url');keys[name]={authorization:'Bearer '+secret,'idempotency-key':name};
    db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_'+name,name,hash(secret),secret.slice(-6),name,'2099-01-01T00:00:00.000Z',null,at);
  }
  const extension={'x-hermo-extension-id':'a'.repeat(32),origin:'chrome-extension://'+'a'.repeat(32),cookie:''};
  const grant=await ok('/studio/connections/website/browser-link',{authorized:true});
  const paired=await ok('/companion/browser/pair',{code:grant.code,origin:state.origin,authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard'],context_id:'bc_'+'a'.repeat(36),tab_id:1},extension);
  const transport={...extension,authorization:'Bearer '+paired.token};
  const poll=()=>ok('/companion/browser/poll',{},transport);
  const reply=(message,value,error)=>ok('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}},transport);
  const snapshot={url:connection.url,title:'Fixture',doc:{elements:[{kind:'button',selector:'#first',label:'First',type:'button',disabled:false}],challenge:false,denied:false,authRejected:false,networkError:false,login:false,credentials:false,textLength:20,readyState:'complete'}};
  const answer=message=>reply(message,message.command.op==='snapshot'?snapshot:message.command.op==='read'?{text:'Verified sibling result',count:1,streaming:false}:true);
  const next=async()=>{while(true){const message=await poll();if(message.type==='command')return message;assert.equal(message.type,'idle');}};
  const operation=async()=>{while(true){const message=await next();if(message.command.op==='operate')return message;await answer(message);}};
  const run=id=>{const row=db.prepare('SELECT * FROM runs WHERE id=?').get(id);return {...row,...unseal(row.payload)};};
  const enqueue=name=>ok('/v1/actions/fixture.'+name+'/versions/1/runs',{input:{}},keys[name]);
  await poll();
  return {...state,call,ok,transport,poll,next,reply,answer,operation,run,enqueue,keys};
}

for(const authorized of [false,true]){
  test('revoking an active key '+(authorized?'after':'before')+' mutation authorization preserves the shared tab',{timeout:20000},async t=>{
    const f=await fixture(t),first=await f.enqueue('first'),command=await f.operation();
    if(authorized)assert.equal((await f.ok('/companion/browser/authorize',{id:command.id},f.transport)).authorized,true);
    await f.ok('/studio/keys/key_first/revoke',{});
    assert.equal((await f.call('/v1/action-contract',undefined,f.keys.first)).status,401);
    const denied=await f.call('/companion/browser/authorize',{id:command.id},f.transport);
    assert.equal(denied.status,409);assert.equal(denied.value.error.code,'BROWSER_COMMAND_CANCELLED');
    assert.equal((await f.ok('/studio/connections/website/browser-link')).linked,true);
    const sibling=await f.enqueue('sibling');await pause(350);
    assert.equal(f.run(sibling.run_id).status,'queued','the tab remains held until the previous command is drained');
    assert.deepEqual(await f.reply(command,true),{ok:true,cancelled:true},'a late browser completion is acknowledged without reviving the cancelled run');
    assert.equal((await f.call('/companion/browser/reply',{id:command.id,ok:true,value:true},f.transport)).status,409,'duplicate replies are not silently accepted');
    const terminal=await until(()=>!['queued','running','verifying'].includes(f.run(first.run_id).status)&&f.run(first.run_id));
    assert.equal(terminal.result,undefined);assert.equal(terminal.error.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(terminal.error.retry_safe,false);
    const siblingCommand=await f.operation();assert.equal(siblingCommand.command.selector,'#sibling');await f.answer(siblingCommand);
    while(['queued','running','verifying'].includes(f.run(sibling.run_id).status)){
      // The adapter polls and settles the declared output before final verification.
      const response=Promise.race([f.next(),until(()=>!['queued','running','verifying'].includes(f.run(sibling.run_id).status)).then(()=>null)]);
      const message=await response;if(!message)break;await f.answer(message);
    }
    assert.equal(f.run(sibling.run_id).status,'succeeded',JSON.stringify(f.run(sibling.run_id)));
    assert.deepEqual(f.run(sibling.run_id).result,{result:'Verified sibling result'});
    assert.equal((await f.ok('/studio/connections/website/browser-link')).linked,true);
  });
}

test('owner cancellation before dispatch removes only that run and preserves its tab',{timeout:15000},async t=>{
  const f=await fixture(t),first=await f.enqueue('first');
  await until(()=>f.run(first.run_id).status==='running');
  await f.ok('/studio/runs/'+first.run_id+'/cancel',{});
  await until(()=>f.run(first.run_id).status==='cancelled');
  assert.equal((await f.ok('/studio/connections/website/browser-link')).linked,true);
  await f.enqueue('sibling');
  const message=await f.next();assert.equal(message.command.op,'snapshot','the undispatched cancelled snapshot was removed');
  await f.answer(message);
  const operation=await f.operation();assert.equal(operation.command.selector,'#sibling');
  await f.ok('/studio/runs/'+(await f.ok('/studio/overview')).runs.find(run=>run.workflow_id==='sibling').id+'/cancel',{});
  await f.reply(operation,true);
});

test('missing cancelled-command acknowledgement still ends an unavailable browser link',{timeout:20000},async t=>{
  const f=await fixture(t),first=await f.enqueue('first'),command=await f.operation();
  await f.ok('/studio/runs/'+first.run_id+'/cancel',{});
  assert.equal((await f.ok('/studio/connections/website/browser-link')).linked,true);
  await until(async()=>!(await f.ok('/studio/connections/website/browser-link')).linked,17000);
  assert.equal((await f.call('/companion/browser/reply',{id:command.id,ok:true,value:true},f.transport)).status,401);
  assert.equal(f.run(first.run_id).status,'cancelled');assert.equal(f.run(first.run_id).result,undefined);
});

async function connectedPage(t){
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('https://example.test/**',route=>route.fulfill({contentType:'text/html',body:'<main><button id="submit" onclick="window.mutations=(window.mutations||0)+1">Search</button><p id="result">Verified result</p></main>'}));
  await page.goto('https://example.test/task');
  const chrome={tabs:{get:async()=>({url:page.url(),status:'complete'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
  const handlers=new Map(),app={post:(path,...args)=>handlers.set(path,args.at(-1)),get:()=>{},options:()=>{}};
  const owner='synthetic-owner',sessions=new Map([[hash(owner),{authenticated:true,expires:Date.now()+60000}]]),extension={'x-hermo-extension-id':'a'.repeat(32)};
  let connection={id:'website',url:page.url(),origins:['https://example.test'],access:'public',browser_mode:'connected',status:'connected'};
  const engine=installConnectedBrowser(app,{origin:'http://127.0.0.1:4317',store:{audit:()=>{}},sessions,ownerCookie:'owner',connection:()=>connection,saveConnection:(_,patch,status)=>{connection={...connection,...patch,status};},invalidate:()=>{},recordings:new Map(),fail:code=>{throw Error(code);},rate:()=>{},stopRuns:()=>{},browserWorkspaces:{},connectionBusy:()=>false,isRecording:()=>false,baseEngine:{close:async()=>{},closeAll:async()=>{}}});
  const invoke=(path,body,headers={})=>handlers.get(path)({method:'POST',body,params:{cid:'website'},cookies:{owner},headers:{...extension,...headers}},{raw:new EventEmitter()});
  const grant=await invoke('/studio/connections/:cid/browser-link',{authorized:true});
  const paired=await invoke('/companion/browser/pair',{code:grant.code,origin:'https://example.test',authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard','semantic_target_guard'],context_id:'bc_'+'a'.repeat(36),tab_id:1});
  const auth={authorization:'Bearer '+paired.token};let running=true;
  const pump=(async()=>{while(running){const message=await invoke('/companion/browser/poll',{},auth);if(message.type==='closed')break;if(message.type!=='command')continue;
    let value,error;try{value=await executeBrowserCommand({chrome,tabId:1,origin:message.origin,pathPrefix:message.path_prefix,command:message.command,inspect:inspectDocument,deadline:message.expires_at,beforeMutation:()=>invoke('/companion/browser/authorize',{id:message.id},auth)});}catch(problem){error=problem.message;}
    if(running)await invoke('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}},auth);
  }})();
  t.after(async()=>{running=false;await engine.closeAll();await pump;});
  const definition={version:'approval-fixture',effect:'recorded_browser_actions',inputs:{},steps:[{op:'click',selector:'#submit',locators:[{kind:'role',role:'button',name:'Search'}],approval_required:true}],outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'nonempty',output:'result'}]};
  return {page,engine,definition,execute:(beforeStep,signal,change={})=>engine.execute(connection,{...definition,...change},{},()=>{},signal,beforeStep)};
}

test('connected approval pauses before the real control and checks its live semantic identity after approval',async t=>{
  const f=await connectedPage(t);let entered=false,release;
  const gate=new Promise(done=>{release=done;});
  const pending=f.execute(async index=>{assert.equal(index,0);entered=true;await gate;});
  await until(()=>entered);assert.equal(await f.page.evaluate(()=>window.mutations),undefined);
  await f.page.locator('#submit').evaluate(button=>{button.textContent='Delete';});release();
  await assert.rejects(pending,{message:'ELEMENT_CHANGED'});
  assert.equal(await f.page.evaluate(()=>window.mutations),undefined);assert.equal(f.engine.isOpen('website'),true);
  await f.page.locator('#submit').evaluate(button=>{button.textContent='Search';});
  assert.deepEqual((await f.execute(async()=>{})).result,{result:'Verified result'});assert.equal(await f.page.evaluate(()=>window.mutations),1);
});

test('connected approval cannot be bypassed by missing callbacks, rejection or cancellation',async t=>{
  const f=await connectedPage(t);
  await assert.rejects(f.execute(),{message:'APPROVAL_REQUIRED'});
  await assert.rejects(f.execute(async()=>{throw Error('APPROVAL_REJECTED');}),{message:'APPROVAL_REJECTED'});
  const controller=new AbortController();let entered=false;
  const pending=f.execute(async()=>{entered=true;await new Promise(()=>{});},controller.signal);
  await until(()=>entered);controller.abort(Error('WORKFLOW_CANCELLED'));
  await assert.rejects(pending,{message:'WORKFLOW_CANCELLED'});
  assert.equal(await f.page.evaluate(()=>window.mutations),undefined);assert.equal(f.engine.isOpen('website'),true);
});

test('a direct connected approval callback that never settles is bounded by the workflow deadline',{timeout:20000},async t=>{
  const f=await connectedPage(t);const began=Date.now();
  await assert.rejects(f.execute(()=>new Promise(()=>{}),undefined,{timeout_ms:15000}),{message:'TIMEOUT'});
  assert.ok(Date.now()-began<16000);assert.equal(await f.page.evaluate(()=>window.mutations),undefined);assert.equal(f.engine.isOpen('website'),true);
});
