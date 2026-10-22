import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('default companion survives forced worker restart and stops delayed actions safely',{timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const port=4396;
  const {app,origin,store}=await createApp({port,dataDir:resolve('work/transport-tests',randomBytes(6).toString('hex'))});
  app.get('/sandbox/weather',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Transport weather</title><main><h1>Colombo weather</h1><output id="temperature">28 C</output><button id="preview-click">Preview action</button><output id="preview-count">0</output></main><script src="/sandbox/preview-action.js"></script>'));
  app.get('/sandbox/preview-action.js',async(_,reply)=>reply.type('text/javascript').send("document.querySelector('#preview-click').onclick=()=>{document.querySelector('#preview-count').textContent=String(Number(document.querySelector('#preview-count').textContent)+1);};"));
  let dropNextPoll=false;
  app.addHook('onRequest',async(req,reply)=>{if(dropNextPoll&&req.url==='/companion/browser/poll'){dropNextPoll=false;reply.hijack();reply.raw.destroy();}});
  await app.listen({port,host:'127.0.0.1'});let context,cookie='',csrf='';
  // This fixture owner explicitly reviews and authorizes configured publication changes.
  const ok=async(path,body)=>{if(body!==undefined&&/^\/studio\/workflows\/[^/]+\/publish$/.test(path)){const review=await ok(path.replace(/\/publish$/,'/permissions'));body={expected_version:review.version,permission_fingerprint:review.fingerprint,...(review.changes?.breaking?{change_fingerprint:review.changes.fingerprint,accept_breaking:true}:{}),...body};}const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...cookie?{cookie}:{},...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf}},body:body===undefined?undefined:JSON.stringify(body)});const set=r.headers.get('set-cookie');if(set?.startsWith('hermo_owner_'))cookie=set.split(';')[0];const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-transport-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Weather transport',url:origin+'/sandbox/weather',access:'public',browser_mode:'connected',authorized:true})).connection;
    context=await chromium.launchPersistentContext('',{headless:true,viewport:null,chromiumSandbox:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging','--window-size=1280,900'],ignoreDefaultArgs:['--disable-extensions']});
    const cdp=await context.browser().newBrowserCDPSession(),{id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});
    const targetCommand=async(targetId,method,params)=>{const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});try{return await new Promise((resolve,reject)=>{const listener=e=>{if(e.sessionId!==sessionId)return;const data=JSON.parse(e.message);if(data.id!==73)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(data.error||data.result?.exceptionDetails)reject(Error(JSON.stringify(data)));else resolve(data.result);};const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Extension command timeout'));},15000);cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:73,method,params})}).catch(reject);});}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}};
    const evaluate=async(targetId,expression)=>(await targetCommand(targetId,'Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
    const readyPopup=async()=>{
      for(let n=0;n<100;n++){
        const popup=(await cdp.send('Target.getTargets')).targetInfos.find(target=>target.url.endsWith('/popup.html'));
        if(popup&&await evaluate(popup.targetId,"document.documentElement?.dataset.hermoReady==='true'"))return popup;
        await new Promise(done=>setTimeout(done,100));
      }
      assert.fail('Companion popup did not finish initializing');
    };
    const site=await context.newPage();await site.goto(origin+'/sandbox/weather');
    const link=()=>ok(`/studio/connections/${connection.id}/browser-link`);
    const pair=async()=>{
      await site.bringToFront();const grant=await ok(`/studio/connections/${connection.id}/browser-link`,{authorized:true});
      const tab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(t=>t.url===site.url());assert.ok(tab);
      await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});
      const popup=await readyPopup();
      await evaluate(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
      for(let n=0;n<100;n++){if((await link()).linked)break;await new Promise(done=>setTimeout(done,100));}
      // Successful pairing can dismiss the popup; only read it to diagnose failure.
      const paired=(await link()).linked;
      assert.equal(paired,true,paired?undefined:await evaluate(popup.targetId,"document.querySelector('#status').textContent"));
      const targets=(await cdp.send('Target.getTargets')).targetInfos;assert.equal(targets.some(t=>t.url.includes('/controller.html')||t.url.includes('/connect.html')),false);
      await cdp.send('Target.closeTarget',{targetId:popup.targetId}).catch(error=>{if(!error.message.includes('No target with given id found'))throw error;});await site.locator('#hermo-connection-panel').waitFor();
    };
    const snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);
    await pair();await ok(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    assert.ok((await snapshot()).elements.some(e=>e.preview==='28 C'));
    await t.test('connected popup preserves its connection and leaves preview off while reviewing reconnect options',async()=>{
      assert.equal((await snapshot()).preview?.state,'disabled');
      await site.bringToFront();const tab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(target=>target.url===site.url());assert.ok(tab);
      await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});const popup=await readyPopup();
      try{
      for(let n=0;n<50;n++){if(await evaluate(popup.targetId,"document.body.dataset.connection==='connected'"))break;await new Promise(done=>setTimeout(done,100));}
      const view=()=>evaluate(popup.targetId,"({connection:document.body.dataset.connection,pairHidden:document.querySelector('#pair').hidden,connectedHidden:document.querySelector('#connected-state').hidden,name:document.querySelector('#connection-name').textContent,stopHidden:document.querySelector('#preview-stop').hidden,openVisible:document.querySelector('#open-workspace').getClientRects().length>0,keepHidden:document.querySelector('#cancel-reconnect').hidden,authorized:document.querySelector('#authorize').checked,code:document.querySelector('#code').value,preview:document.querySelector('#live-preview').dataset.preview})");
      assert.deepEqual(await view(),{connection:'connected',pairHidden:true,connectedHidden:false,name:'Weather transport',stopHidden:true,openVisible:true,keepHidden:true,authorized:false,code:'',preview:'disabled'});
      assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(target=>target.url.endsWith('/preview-offscreen.html')),false,'no preview document exists before explicit opt-in');
      await evaluate(popup.targetId,"document.querySelector('#reconnect-tab').click();true");
      const reconnect=await view();assert.equal(reconnect.pairHidden,false);assert.equal(reconnect.connectedHidden,true);assert.equal(reconnect.keepHidden,false);assert.equal(reconnect.authorized,false);assert.equal(reconnect.code,'');
      assert.equal((await link()).linked,true,'reviewing reconnect options does not revoke the current session');
      await evaluate(popup.targetId,"document.querySelector('#cancel-reconnect').click();true");
      const kept=await view();assert.equal(kept.connection,'connected');assert.equal(kept.pairHidden,true);assert.equal(kept.connectedHidden,false);assert.equal(kept.keepHidden,true);assert.equal(kept.name,'Weather transport');assert.equal(kept.stopHidden,true);assert.equal(kept.preview,'disabled');
      assert.equal((await link()).linked,true);
      await evaluate(popup.targetId,'document.activeElement.blur();true');
      await mkdir(resolve('work/companion-redesign'),{recursive:true});const screenshot=await targetCommand(popup.targetId,'Page.captureScreenshot',{format:'png'});
      await writeFile(resolve('work/companion-redesign/connected-popup.png'),Buffer.from(screenshot.data,'base64'));
      }catch(error){t.diagnostic('Connected popup check failed: '+error.message);throw error;}finally{await cdp.send('Target.closeTarget',{targetId:popup.targetId}).catch(()=>{});}
      const after=await snapshot();assert.equal(after.preview?.state,'disabled','opening and reviewing the popup does not capture the tab');assert.ok(after.elements.some(element=>element.preview==='28 C'),'keeping the connection preserves actual browser commands');
    });
    await t.test('actual tabCapture frames support guarded preview clicks through the extension',async()=>{
      await site.bringToFront();const tab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(t=>t.url===site.url());
      await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});const popup=await readyPopup();
      await evaluate(popup.targetId,"document.querySelector('#preview-enable').click();true");
      let frame;for(let n=0;n<80;n++){frame=await snapshot();if(frame.preview?.state==='live'&&frame.preview.interaction_id)break;await new Promise(done=>setTimeout(done,100));}
      if(!frame.preview?.interaction_id)console.log('Preview dimensions: '+JSON.stringify({preview:frame.preview,viewport:await site.evaluate(()=>({width:innerWidth,height:innerHeight}))}));
      assert.equal(frame.preview?.state,'live','Chrome must deliver a live frame after explicit capture');assert.ok(frame.preview.interaction_id,'real captured frame can be interacted with');
      const point=await site.locator('#preview-click').evaluate(node=>{const b=node.getBoundingClientRect();return {x:(b.x+b.width/2)/innerWidth,y:(b.y+b.height/2)/innerHeight};});
      const picked=await ok(`/studio/connections/${connection.id}/preview-target`,{frame_id:frame.preview.interaction_id,...point});
      await ok(`/studio/connections/${connection.id}/control`,{element_id:picked.element_id,kind:'click',preview_guard:picked.guard});assert.equal(await site.locator('#preview-count').textContent(),'1');
      await site.bringToFront();await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});const stopPopup=await readyPopup();
      await evaluate(stopPopup.targetId,"(async()=>{const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];return chrome.runtime.sendMessage({type:'hermo.preview.stop',tabId:tab.id});})()");
      for(let n=0;n<30;n++){if((await snapshot()).preview?.state==='disabled')break;await new Promise(done=>setTimeout(done,100));}
      await cdp.send('Target.closeTarget',{targetId:stopPopup.targetId}).catch(()=>{});
    });
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
    await t.test('revoking one active workflow key drains its command and keeps the companion available to another workflow',async()=>{
      const keys={},at=new Date().toISOString();
      for(const name of ['revoked','sibling']){
        const definition={version:name,effect:name==='revoked'?'recorded_browser_actions':'retrieval',timeout_ms:15000,inputs:{},steps:name==='revoked'?[{op:'click',selector:'#delayed-submit'}]:[],outputs:[{name:'temperature',selector:'#temperature'}],verifiers:[{kind:'nonempty',output:'temperature'}]};
        store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('transport_'+name,connection.id,name,'transport.'+name,'published',name,store.seal(definition),name,at);
        const secret='hm_live_'+randomBytes(32).toString('base64url');keys[name]=secret;
        store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('transport_key_'+name,name,hash(secret),secret.slice(-6),'transport_'+name,'2099-01-01T00:00:00.000Z',null,at);
      }
      const start=async name=>{const response=await fetch(origin+'/v1/actions/transport.'+name+'/versions/1/runs',{method:'POST',headers:{authorization:'Bearer '+keys[name],'content-type':'application/json','idempotency-key':name},body:JSON.stringify({input:{}})});assert.equal(response.status,202);return response.json();};
      await site.locator('#delayed-submit').evaluate(button=>{button.disabled=true;});
      const revoked=await start('revoked');let issuing=false;
      for(let n=0;n<80;n++){const run=await ok('/studio/runs/'+revoked.run_id);if(run.steps?.[0]?.status==='running'&&run.submission_may_have_occurred){issuing=true;break;}await new Promise(done=>setTimeout(done,50));}
      assert.equal(issuing,true,'the real extension is waiting for the disabled workflow control');
      await new Promise(done=>setTimeout(done,250));
      await ok('/studio/keys/transport_key_revoked/revoke',{});
      const sibling=await start('sibling');
      await site.locator('#delayed-submit').evaluate(button=>{button.disabled=false;});
      let completed;
      for(let n=0;n<100;n++){completed=await ok('/studio/runs/'+sibling.run_id);if(!['queued','running','verifying'].includes(completed.status))break;await new Promise(done=>setTimeout(done,100));}
      assert.equal(completed.status,'succeeded',JSON.stringify(completed));assert.deepEqual(completed.result,{temperature:'28 C'});
      assert.equal((await link()).linked,true);assert.equal(await site.evaluate(()=>window.hermoSyntheticSubmissions),0,'revoked command never reaches the website click');
      assert.equal((await ok('/studio/runs/'+revoked.run_id)).result,undefined);
      assert.ok((await snapshot()).elements.some(element=>element.preview==='28 C'));
    });
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
    await evaluate(worker.targetId,'globalThis.hermoTransportInterruptedWorker=true;true');
    const swUnknown=await context.newCDPSession(site),unknownVersions=new Map();
    swUnknown.on('ServiceWorker.workerVersionUpdated',({versions:updated})=>{for(const value of updated)unknownVersions.set(value.versionId,value);});await swUnknown.send('ServiceWorker.enable');
    for(let n=0;n<40&&!Array.from(unknownVersions.values()).some(value=>value.scriptURL===worker.url&&value.status==='activated');n++)await new Promise(done=>setTimeout(done,100));
    const unknownVersion=Array.from(unknownVersions.values()).filter(value=>value.scriptURL===worker.url&&value.status==='activated').at(-1);assert.ok(unknownVersion);
    await swUnknown.send('ServiceWorker.stopWorker',{versionId:unknownVersion.versionId});await swUnknown.detach();
    for(let n=0;n<40;n++){if(!(await cdp.send('Target.getTargets')).targetInfos.some(target=>target.targetId===worker.targetId))break;await new Promise(done=>setTimeout(done,100));}
    assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(target=>target.targetId===worker.targetId),false,'the uncertain worker was terminated');
    await site.locator('#delayed-submit').evaluate(button=>{button.disabled=false;});await site.bringToFront();
    const wakeTab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(value=>value.url===site.url());
    // Opening the production popup wakes the worker; recovery may dismiss it again.
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:wakeTab.targetId});
    for(let n=0;n<80;n++){if(!(await link()).linked)break;await new Promise(done=>setTimeout(done,100));}
    assert.equal((await link()).linked,false,'unknown in-flight recovery never restores execution authority');assert.ok((await uncertainOperation).status>=400);
    const recoveredWorker=(await cdp.send('Target.getTargets')).targetInfos.find(target=>target.type==='service_worker'&&target.url.endsWith('/background.mjs'));
    assert.ok(recoveredWorker,'the production popup woke the worker');
    // Chrome can reuse the target ID after restart; execution globals must be fresh.
    assert.equal(await evaluate(recoveredWorker.targetId,'typeof globalThis.hermoTransportInterruptedWorker'), 'undefined','recovery uses a fresh worker execution context');
    assert.deepEqual((await evaluate(recoveredWorker.targetId,'chrome.storage.session.get("hermoScopedBrowserSessions")')).hermoScopedBrowserSessions,[],'uncertain recovery clears durable execution authority');
    await new Promise(done=>setTimeout(done,250));assert.equal(await site.evaluate(()=>window.hermoSyntheticSubmissions),0,'unknown in-flight click was never repeated');
    // Chrome may dismiss the popup when the website regains focus during the checks above.
    const wakePopup=(await cdp.send('Target.getTargets')).targetInfos.find(target=>target.url.endsWith('/popup.html'));
    if(wakePopup)await cdp.send('Target.closeTarget',{targetId:wakePopup.targetId});
    await pair();await site.goto(origin+'/outside-scope');for(let n=0;n<40;n++){if(!(await link()).linked)break;await new Promise(done=>setTimeout(done,100));}assert.equal((await link()).linked,false,'leaving sandbox path ends access');
    await site.goto(origin+'/sandbox/weather');await pair();await ok('/studio/logout',{});await new Promise(done=>setTimeout(done,1000));
    const finalWorker=(await cdp.send('Target.getTargets')).targetInfos.find(value=>value.type==='service_worker'&&value.url.endsWith('/background.mjs'));assert.ok(finalWorker);
    const states=await evaluate(finalWorker.targetId,'globalThis.hermoConnectionStates');assert.ok(Object.values(states).every(s=>['offline','stopped'].includes(s.state)),JSON.stringify(states));
    const storage=await evaluate(finalWorker.targetId,'chrome.storage.local.get(null)');assert.equal(JSON.stringify(storage).includes('hb_session_'),false);assert.equal(JSON.stringify(storage).includes('hb_pair_'),false);
  }finally{await context?.close();await app.close();}
});
