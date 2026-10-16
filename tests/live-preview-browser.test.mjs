import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';

test('explicit Chrome tab stream previews the actual background website and stops without restoring capture',{timeout:150000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const port=4456;
  const {app,origin}=await createApp({port,dataDir:resolve('work/live-preview',randomBytes(6).toString('hex'))});
  app.get('/sandbox/live-preview',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Owned preview fixture</title><style>html,body{margin:0;width:100%;height:100%;background:rgb(220,30,30)}h1{margin:0;padding:20px;font:24px system-ui;color:white}</style><main><h1>Actual authorized website</h1><output id="value">Owned fixture value</output></main>'));
  await app.listen({port,host:'127.0.0.1'});let context,cookie='',csrf='';
  const ok=async(path,body)=>{
    const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...cookie?{cookie}:{},...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf}},body:body===undefined?undefined:JSON.stringify(body)});
    const set=response.headers.get('set-cookie');if(set?.startsWith('hermo_owner_'))cookie=set.split(';')[0];const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
  };
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-preview-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Owned visual tab',url:origin+'/sandbox/live-preview',access:'public',browser_mode:'connected',authorized:true})).connection;
    context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,viewport:{width:1000,height:700},executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
    const cdp=await context.browser().newBrowserCDPSession(),{id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});
    const evaluate=async(targetId,expression)=>{
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});
      try{return await new Promise((resolve,reject)=>{
        const listener=event=>{if(event.sessionId!==sessionId)return;const data=JSON.parse(event.message);if(data.id!==74)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(data.error||data.result?.exceptionDetails)reject(Error(JSON.stringify(data)));else resolve(data.result.result.value);};
        const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Preview extension evaluation timeout'));},15000);cdp.on('Target.receivedMessageFromTarget',listener);
        cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:74,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,userGesture:true}})}).catch(reject);
      });}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
    };
    const site=await context.newPage();await site.goto(origin+'/sandbox/live-preview');
    const openPopup=async()=>{
      await site.bringToFront();const tab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(value=>value.url===site.url());assert.ok(tab);
      await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});
      for(let i=0;i<50;i++){const popup=(await cdp.send('Target.getTargets')).targetInfos.find(value=>value.url.endsWith('/popup.html'));if(popup&&await evaluate(popup.targetId,"document.documentElement.dataset.hermoReady==='true'").catch(()=>false))return popup;await new Promise(done=>setTimeout(done,100));}
      assert.fail('Chrome did not open the companion popup');
    };
    const grant=await ok(`/studio/connections/${connection.id}/browser-link`,{authorized:true}),popup=await openPopup();
    await evaluate(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
    for(let i=0;i<100;i++){if((await ok(`/studio/connections/${connection.id}/browser-link`)).linked)break;await new Promise(done=>setTimeout(done,100));}
    assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,true,await evaluate(popup.targetId,"document.querySelector('#status').textContent"));
    await ok(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    let worker=(await cdp.send('Target.getTargets')).targetInfos.find(value=>value.url.endsWith('/background.mjs'));assert.ok(worker);
    assert.deepEqual(await evaluate(worker.targetId,'chrome.tabCapture.getCapturedTabs()'),[],'connecting a tab never silently starts capture');
    for(let i=0;i<40;i++){if(!await evaluate(popup.targetId,"document.querySelector('#preview-enable').disabled"))break;await new Promise(done=>setTimeout(done,100));}
    await evaluate(popup.targetId,"document.querySelector('#preview-enable').click();true");
    for(let i=0;i<60;i++){if((await evaluate(popup.targetId,"document.querySelector('#preview-status').textContent")).startsWith('Live preview enabled'))break;await new Promise(done=>setTimeout(done,100));}
    assert.match(await evaluate(popup.targetId,"document.querySelector('#preview-status').textContent"),/^Live preview enabled/);
    await cdp.send('Target.closeTarget',{targetId:popup.targetId});
    const decoder=await context.newPage();await decoder.goto('about:blank');await decoder.bringToFront();
    const color=async image=>decoder.evaluate(async base64=>{const image=new Image();image.src='data:image/jpeg;base64,'+base64;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return [...context.getImageData(Math.floor(image.width*.5),Math.floor(image.height*.75),1,1).data];},image);
    const snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);
    let first;for(let i=0;i<40;i++){first=await snapshot();if(first.preview?.state==='live'&&first.image)break;await new Promise(done=>setTimeout(done,100));}
    assert.equal(first.preview?.state,'live',JSON.stringify(first.preview));assert.ok(first.image.length<600000);assert.ok(first.preview.captured_at>Date.now()-5000);assert.ok(first.preview.width>0&&first.preview.width<=1600);
    const red=await color(first.image);assert.ok(red[0]>180&&red[1]<70&&red[2]<70,'first frame shows the actual red website: '+red);
    await new Promise(done=>setTimeout(done,5500));
    const unchanged=await snapshot();assert.equal(unchanged.preview?.state,'live','a healthy unchanged background website continues delivering real video frames');
    assert.ok(unchanged.preview.captured_at>first.preview.captured_at+1000,'frame arrival time advances on a static website without sample-time fabrication');
    await site.evaluate(()=>{document.documentElement.style.background=document.body.style.background='rgb(30,200,70)';document.querySelector('#value').textContent='New live value';});
    let second,green;for(let i=0;i<40;i++){second=await snapshot();if(second.image){green=await color(second.image);if(green[1]>170&&green[0]<70)break;}await new Promise(done=>setTimeout(done,100));}
    assert.ok(green[1]>170&&green[0]<70,'background tab stream reflects the website update: '+green);assert.notEqual(second.image,first.image);
    const targets=(await cdp.send('Target.getTargets')).targetInfos;assert.equal(targets.some(value=>value.url.includes('/controller.html')||value.url.includes('/connect.html')),false);assert.ok(targets.some(value=>value.url.endsWith('/preview-offscreen.html')),'capture uses a hidden offscreen document');
    const saved=JSON.stringify(await evaluate(worker.targetId,'chrome.storage.session.get()'));
    assert.equal(/one-use-owned-tab-stream|data:image\/jpeg|expires_at.*preview|streamId/.test(saved),false,'capture grant and pixels are never persisted');
    const sw=await context.newCDPSession(site),versions=new Map();sw.on('ServiceWorker.workerVersionUpdated',({versions:updated})=>{for(const version of updated)versions.set(version.versionId,version);});await sw.send('ServiceWorker.enable');
    for(let i=0;i<40&&!Array.from(versions.values()).some(value=>value.scriptURL===worker.url);i++)await new Promise(done=>setTimeout(done,100));
    const version=Array.from(versions.values()).find(value=>value.scriptURL===worker.url);assert.ok(version);
    await sw.send('ServiceWorker.stopWorker',{versionId:version.versionId});
    for(let i=0;i<40;i++){if(!(await cdp.send('Target.getTargets')).targetInfos.some(value=>value.targetId===worker.targetId))break;await new Promise(done=>setTimeout(done,100));}
    assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(value=>value.targetId===worker.targetId),false,'the capture-owning service worker was actually stopped');
    const recoveredPopup=await openPopup();
    for(let i=0;i<40;i++){if(!await evaluate(recoveredPopup.targetId,"document.querySelector('#preview-enable').disabled"))break;await new Promise(done=>setTimeout(done,100));}
    assert.match(await evaluate(recoveredPopup.targetId,"document.querySelector('#preview-status').textContent"),/^Preview is off/);
    worker=(await cdp.send('Target.getTargets')).targetInfos.find(value=>value.url.endsWith('/background.mjs'));assert.ok(worker);
    assert.equal((await evaluate(worker.targetId,'chrome.tabCapture.getCapturedTabs()')).some(value=>value.status==='active'),false,'restoring automation authority never restores visual capture');
    assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(value=>value.url.endsWith('/preview-offscreen.html')),false,'restoration closes the old offscreen document');
    assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,true,'authorized automation connection survives worker recovery');
    await sw.detach();
    const enable=async target=>{
      await evaluate(target,"document.querySelector('#preview-enable').click();true");
      for(let i=0;i<60;i++){if((await evaluate(target,"document.querySelector('#preview-status').textContent")).startsWith('Live preview enabled'))break;await new Promise(done=>setTimeout(done,100));}
      assert.match(await evaluate(target,"document.querySelector('#preview-status').textContent"),/^Live preview enabled/);
    };
    await enable(recoveredPopup.targetId);await evaluate(recoveredPopup.targetId,"document.querySelector('#preview-stop').click();true");
    for(let i=0;i<40;i++){if((await evaluate(recoveredPopup.targetId,"document.querySelector('#preview-status').textContent")).startsWith('Preview is off'))break;await new Promise(done=>setTimeout(done,100));}
    assert.match(await evaluate(recoveredPopup.targetId,"document.querySelector('#preview-status').textContent"),/^Preview is off/);
    assert.equal((await evaluate(worker.targetId,'chrome.tabCapture.getCapturedTabs()')).some(value=>value.status==='active'),false);
    assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,true,'Stop preview preserves the workflow connection');
    await enable(recoveredPopup.targetId);await cdp.send('Target.closeTarget',{targetId:recoveredPopup.targetId});
    // Navigation outside the granted origin/path stops the stream, even when
    // no dashboard requests are in flight.
    await site.goto(origin+'/connected-browser.html');
    for(let i=0;i<40;i++){const captured=await evaluate(worker.targetId,'chrome.tabCapture.getCapturedTabs()');if(!captured.some(value=>value.status==='active'))break;await new Promise(done=>setTimeout(done,100));}
    assert.equal((await evaluate(worker.targetId,'chrome.tabCapture.getCapturedTabs()')).some(value=>value.status==='active'),false);
    assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(value=>value.url.endsWith('/preview-offscreen.html')),false);
    assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,false);
  }finally{await context?.close();await app.close();}
});
