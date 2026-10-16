import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';

test('default companion survives forced worker restart and stops delayed actions safely',{timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const port=4396;
  const {app,origin}=await createApp({port,dataDir:resolve('work/transport-tests',randomBytes(6).toString('hex'))});
  app.get('/sandbox/weather',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Transport weather</title><main><h1>Colombo weather</h1><output id="temperature">28 C</output></main>'));
  let dropNextPoll=false;
  app.addHook('onRequest',async(req,reply)=>{if(dropNextPoll&&req.url==='/companion/browser/poll'){dropNextPoll=false;reply.hijack();reply.raw.destroy();}});
  await app.listen({port,host:'127.0.0.1'});let context,cookie='',csrf='';
  const ok=async(path,body)=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...cookie?{cookie}:{},...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf}},body:body===undefined?undefined:JSON.stringify(body)});const set=r.headers.get('set-cookie');if(set?.startsWith('hermo_owner_'))cookie=set.split(';')[0];const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-transport-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Weather transport',url:origin+'/sandbox/weather',access:'public',browser_mode:'connected',authorized:true})).connection;
    context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
    const cdp=await context.browser().newBrowserCDPSession(),{id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});
    const evaluate=async(targetId,expression)=>{const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});try{return await new Promise((resolve,reject)=>{const listener=e=>{if(e.sessionId!==sessionId)return;const data=JSON.parse(e.message);if(data.id!==73)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(data.error||data.result?.exceptionDetails)reject(Error(JSON.stringify(data)));else resolve(data.result.result.value);};const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Extension evaluation timeout'));},15000);cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:73,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);});}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}};
    const site=await context.newPage();await site.goto(origin+'/sandbox/weather');
    const link=()=>ok(`/studio/connections/${connection.id}/browser-link`);
    const pair=async()=>{
      await site.bringToFront();const grant=await ok(`/studio/connections/${connection.id}/browser-link`,{authorized:true});
      const tab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(t=>t.url===site.url());assert.ok(tab);
      await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});await new Promise(done=>setTimeout(done,500));
      const popup=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup.html'));assert.ok(popup);
      await evaluate(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
      for(let n=0;n<100;n++){if((await link()).linked)break;await new Promise(done=>setTimeout(done,100));}
      assert.equal((await link()).linked,true,await evaluate(popup.targetId,"document.querySelector('#status').textContent"));
      const targets=(await cdp.send('Target.getTargets')).targetInfos;assert.equal(targets.some(t=>t.url.includes('/controller.html')||t.url.includes('/connect.html')),false);
      await cdp.send('Target.closeTarget',{targetId:popup.targetId});await site.locator('#hermo-connection-panel').waitFor();
    };
    const snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);
    await pair();await ok(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    assert.ok((await snapshot()).elements.some(e=>e.preview==='28 C'));
    await t.test('closing the dashboard preserves scoped published REST execution',async()=>{
      const recording=await ok('/studio/recordings',{connection_id:connection.id,name:'Weather without dashboard',slug:'weather.dashboard.closed',action_type:'read'});
      const temperature=(await snapshot()).elements.find(element=>element.preview==='28 C');assert.ok(temperature);
      await ok(`/studio/recordings/${recording.id}/output`,{element_id:temperature.id,name:'temperature'});
      const workflow=(await ok(`/studio/recordings/${recording.id}/finish`,{verifiers:[{kind:'number',output:'temperature',unit:'C'}]})).workflow;
      const testRun=await ok(`/studio/workflows/${workflow.id}/test`,{input:{}});let verified;
      for(let n=0;n<150;n++){verified=await ok(`/studio/runs/${testRun.run_id}`);if(!['queued','running','verifying'].includes(verified.status))break;await new Promise(done=>setTimeout(done,100));}
      assert.equal(verified.status,'succeeded',JSON.stringify(verified));const key=await ok(`/studio/workflows/${workflow.id}/publish`,{});
      await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
      const dashboard=await context.newPage();await dashboard.goto(origin+'/#actions');await dashboard.locator('.app-shell').waitFor();await dashboard.close();
      assert.equal(dashboard.isClosed(),true);assert.equal(site.isClosed(),false);assert.equal((await link()).linked,true,'closing dashboard differs from Stop or Lock');
      // Change the actual selected website after dashboard closure. The API
      // must observe this value rather than return the earlier test result.
      await site.locator('#temperature').evaluate(element=>{element.textContent='29 C';});
      const auth={authorization:'Bearer '+key.key},accepted=await fetch(origin+`/v1/actions/${workflow.slug}/versions/1/runs`,{method:'POST',headers:{...auth,'content-type':'application/json','idempotency-key':'after-dashboard-closed'},body:JSON.stringify({input:{}})});
      assert.equal(accepted.status,202);const receipt=await accepted.json();assert.ok(receipt.run_id);let result;
      for(let n=0;n<150;n++){const response=await fetch(origin+'/v1/runs/'+receipt.run_id,{headers:auth});assert.equal(response.status,200);result=await response.json();if(!['queued','running','verifying'].includes(result.status))break;await new Promise(done=>setTimeout(done,100));}
      assert.equal(result.status,'succeeded',JSON.stringify(result));assert.deepEqual(result.result,{temperature:'29 C'});assert.ok(result.verification.checks.includes('temperature_number'));
      assert.equal(dashboard.isClosed(),true);assert.equal((await link()).linked,true);await site.locator('#temperature').evaluate(element=>{element.textContent='28 C';});
    });
    const workerBefore=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.endsWith('/background.mjs'));assert.ok(workerBefore);
    const sessionStorage=await evaluate(workerBefore.targetId,'chrome.storage.session.get("hermoScopedBrowserSessions")');
    assert.equal(sessionStorage.hermoScopedBrowserSessions.length,1);assert.match(sessionStorage.hermoScopedBrowserSessions[0].token,/^hb_session_/);
    assert.equal(sessionStorage.hermoScopedBrowserSessions[0].inFlight,undefined);
    const recoveryAlarm=await evaluate(workerBefore.targetId,'chrome.alarms.get("hermo.connection.recover")');assert.equal(recoveryAlarm?.periodInMinutes,0.5,'a real recovery alarm is registered');
    // Actually terminate the MV3 worker, then let its persisted 30s alarm wake it.
    // A sleep while the old worker calls Chrome APIs does not prove recovery.
    const sw=await context.newCDPSession(site),versions=new Map();
    sw.on('ServiceWorker.workerVersionUpdated',({versions:updated})=>{for(const version of updated)versions.set(version.versionId,version);});
    await sw.send('ServiceWorker.enable');
    for(let n=0;n<40&&!Array.from(versions.values()).some(v=>v.scriptURL===workerBefore.url);n++)await new Promise(done=>setTimeout(done,100));
    const version=Array.from(versions.values()).find(v=>v.scriptURL===workerBefore.url);assert.ok(version,'Chrome exposes the actual extension service worker');
    await sw.send('ServiceWorker.stopWorker',{versionId:version.versionId});
    for(let n=0;n<40;n++){if(!(await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===workerBefore.targetId))break;await new Promise(done=>setTimeout(done,100));}
    assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===workerBefore.targetId),false,'old worker was terminated');
    let restored;
    for(let n=0;n<450;n++){restored=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.endsWith('/background.mjs'));if(restored)break;await new Promise(done=>setTimeout(done,100));}
    assert.ok(restored,'Chrome alarm wakes a new worker without dashboard or popup; registered '+JSON.stringify(recoveryAlarm));await sw.detach();
    assert.equal((await link()).linked,true);assert.ok((await snapshot()).elements.some(e=>e.preview==='28 C'),'recovered token executes a real command');
    dropNextPoll=true;await snapshot();
    for(let n=0;n<40&&dropNextPoll;n++)await new Promise(done=>setTimeout(done,50));assert.equal(dropNextPoll,false,'the real idle poll transport was interrupted');
    assert.ok((await snapshot()).elements.some(e=>e.preview==='28 C'),'idle network retry preserves authorized connection');assert.equal((await link()).linked,true);
    await site.reload();await site.locator('#hermo-connection-panel').waitFor({timeout:8000});assert.ok((await snapshot()).elements.some(e=>e.preview==='28 C'));
    const worker=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.endsWith('/background.mjs'));assert.ok(worker);
    await site.evaluate(()=>{const button=document.createElement('button');button.id='delayed-submit';button.textContent='Submit delayed task';window.hermoSyntheticSubmissions=0;button.addEventListener('click',()=>window.hermoSyntheticSubmissions++);document.querySelector('main').append(button);});
    const control=(await snapshot()).elements.find(e=>e.label==='Submit delayed task');assert.ok(control);
    await site.locator('#delayed-submit').evaluate(button=>{button.disabled=true;});
    const operation=fetch(origin+`/studio/connections/${connection.id}/control`,{method:'POST',headers:{cookie,'content-type':'application/json','x-hermo-csrf':csrf},body:JSON.stringify({element_id:control.id,kind:'click'})}).then(async response=>({status:response.status,body:await response.json()}));
    let waiting;
    for(let n=0;n<30;n++){waiting=(await evaluate(worker.targetId,'chrome.storage.session.get("hermoScopedBrowserSessions")')).hermoScopedBrowserSessions?.[0]?.inFlight;if(waiting)break;await new Promise(done=>setTimeout(done,50));}
    assert.ok(waiting,'the real control command is waiting before Stop');
    const stopPosition=await evaluate(worker.targetId,"(async()=>{const r=await chrome.scripting.executeScript({target:{tabId:(await chrome.tabs.query({})).find(t=>t.url?.includes('/sandbox/weather')).id},world:'ISOLATED',func:()=>{const b=document.getElementById('hermo-connection-panel').__hermoView.root.querySelector('.stop').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};}});return r[0].result;})()");
    await site.mouse.click(stopPosition.x,stopPosition.y);for(let n=0;n<40;n++){if(!(await link()).linked)break;await new Promise(done=>setTimeout(done,100));}assert.equal((await link()).linked,false);
    await site.locator('#delayed-submit').evaluate(button=>{button.disabled=false;});await new Promise(done=>setTimeout(done,500));
    assert.equal(await site.evaluate(()=>window.hermoSyntheticSubmissions),0,'Stop prevents an action that was waiting for readiness');assert.ok((await operation).status>=400);
    assert.deepEqual((await evaluate(worker.targetId,'chrome.storage.session.get("hermoScopedBrowserSessions")')).hermoScopedBrowserSessions,[],'Stop clears recoverable authority');
    // Terminating a worker with a persisted command must fail closed, even when
    // the same authorized tab and token still exist. Never replay its click.
    await pair();const uncertainControl=(await snapshot()).elements.find(e=>e.label==='Submit delayed task');assert.ok(uncertainControl);
    await site.locator('#delayed-submit').evaluate(button=>{button.disabled=true;});
    const uncertainOperation=fetch(origin+`/studio/connections/${connection.id}/control`,{method:'POST',headers:{cookie,'content-type':'application/json','x-hermo-csrf':csrf},body:JSON.stringify({element_id:uncertainControl.id,kind:'click'})}).then(async response=>({status:response.status,body:await response.json()}));
    let pending;
    for(let n=0;n<40;n++){pending=(await evaluate(worker.targetId,'chrome.storage.session.get("hermoScopedBrowserSessions")')).hermoScopedBrowserSessions?.[0]?.inFlight;if(pending)break;await new Promise(done=>setTimeout(done,50));}
    assert.ok(pending,'in-flight marker is durable before browser operation');
    const swUnknown=await context.newCDPSession(site),unknownVersions=new Map();
    swUnknown.on('ServiceWorker.workerVersionUpdated',({versions:updated})=>{for(const value of updated)unknownVersions.set(value.versionId,value);});await swUnknown.send('ServiceWorker.enable');
    for(let n=0;n<40&&!Array.from(unknownVersions.values()).some(value=>value.scriptURL===worker.url&&value.status==='activated');n++)await new Promise(done=>setTimeout(done,100));
    const unknownVersion=Array.from(unknownVersions.values()).filter(value=>value.scriptURL===worker.url&&value.status==='activated').at(-1);assert.ok(unknownVersion);
    await swUnknown.send('ServiceWorker.stopWorker',{versionId:unknownVersion.versionId});await swUnknown.detach();
    await site.locator('#delayed-submit').evaluate(button=>{button.disabled=false;});await site.bringToFront();
    const wakeTab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(value=>value.url===site.url());
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:wakeTab.targetId});await new Promise(done=>setTimeout(done,500));
    const wakePopup=(await cdp.send('Target.getTargets')).targetInfos.find(value=>value.url.endsWith('/popup.html'));assert.ok(wakePopup);
    await evaluate(wakePopup.targetId,'chrome.runtime.sendMessage({type:"hermo.recovery.probe"}).catch(()=>{});true');
    for(let n=0;n<80;n++){if(!(await link()).linked)break;await new Promise(done=>setTimeout(done,100));}
    assert.equal((await link()).linked,false,'unknown in-flight recovery never restores execution authority');assert.ok((await uncertainOperation).status>=400);
    await new Promise(done=>setTimeout(done,250));assert.equal(await site.evaluate(()=>window.hermoSyntheticSubmissions),0,'unknown in-flight click was never repeated');
    await cdp.send('Target.closeTarget',{targetId:wakePopup.targetId});
    await pair();await site.goto(origin+'/outside-scope');for(let n=0;n<40;n++){if(!(await link()).linked)break;await new Promise(done=>setTimeout(done,100));}assert.equal((await link()).linked,false,'leaving sandbox path ends access');
    await site.goto(origin+'/sandbox/weather');await pair();await ok('/studio/logout',{});await new Promise(done=>setTimeout(done,1000));
    const finalWorker=(await cdp.send('Target.getTargets')).targetInfos.find(value=>value.type==='service_worker'&&value.url.endsWith('/background.mjs'));assert.ok(finalWorker);
    const states=await evaluate(finalWorker.targetId,'globalThis.hermoConnectionStates');assert.ok(Object.values(states).every(s=>['offline','stopped'].includes(s.state)),JSON.stringify(states));
    const storage=await evaluate(finalWorker.targetId,'chrome.storage.local.get(null)');assert.equal(JSON.stringify(storage).includes('hb_session_'),false);assert.equal(JSON.stringify(storage).includes('hb_pair_'),false);
  }finally{await context?.close();await app.close();}
});
