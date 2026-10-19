import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {existsSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {openStore} from '../server/store.mjs';
import {normalChromeArguments} from '../server/normal-chrome.mjs';
import {verifyResult} from '../server/verification.mjs';

test('output rules preserve equality, validate data context, and permit unchanged values',()=>{
  const d={version:'test',inputs:{},outputs:[{name:'temperature'},{name:'location'}],verifiers:[{kind:'number',output:'temperature',unit:'\u00b0C'},{kind:'contains',output:'location',value:'Colombo'}]};
  for(let i=0;i<2;i++)assert.ok(verifyResult(d,{temperature:'28 °C',location:'Colombo'}, {},'public_source_origin').observed_at);
  assert.throws(()=>verifyResult(d,{temperature:'28 \u00b0F',location:'Colombo'}, {},'source'),e=>e.verification.reason==='unit_mismatch');
  assert.throws(()=>verifyResult(d,{temperature:'warm',location:'Colombo'}, {},'source'),e=>e.verification.reason==='invalid_number');
  assert.throws(()=>verifyResult(d,{temperature:'28 °C',location:'London'}, {},'source'),e=>e.verification.reason==='context_mismatch');
  assert.throws(()=>verifyResult(d,{temperature:'',location:'Colombo'}, {},'source'),e=>e.verification.reason==='missing_output');
  assert.ok(verifyResult({version:'legacy',outputs:[{name:'echo'}],verifiers:[{output:'echo',input:'prompt'}]},{echo:'hello'},{prompt:'hello'},'account_identity').checks.includes('echo_matches_prompt'));
  assert.throws(()=>verifyResult({outputs:[{name:'echo'}],verifiers:[{output:'echo',input:'prompt'}]},{echo:'different'},{prompt:'hello'},'source'));
});

test('schema migration backs up committed SQLite and preserves existing encrypted data',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const directory=resolve('work/simplification-migration',randomBytes(6).toString('hex'));
  let store=openStore(directory);store.db.exec('DROP TABLE browser_workspaces');
  store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_old','Existing app','https://example.com/','connected',store.seal({url:'https://example.com/',origins:['https://example.com'],access:'account',browser_mode:'connected',identity:{selector:'#account',text:'Existing account'}}),new Date().toISOString());store.setSetting('sentinel',store.seal({value:'saved-private-data'}));store.close();
  const instance=await createApp({port:4393,dataDir:directory});
  try{
    const row=instance.store.db.prepare('SELECT * FROM connections WHERE id=?').get('conn_old'),saved=instance.store.unseal(row.payload);assert.equal(saved.identity.text,'Existing account');assert.ok(saved.browser_workspace_id);
    const backup=join(directory,'before-browser-workspaces.sqlite');assert.ok(existsSync(backup));const db=new DatabaseSync(backup);try{assert.equal(db.prepare('SELECT name FROM connections WHERE id=?').get('conn_old').name,'Existing app');assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='browser_workspaces'").get(),undefined);}finally{db.close();}
    assert.equal(instance.store.unseal(instance.store.getSetting('sentinel')).value,'saved-private-data');
    const rollback=join(directory,'rollback');mkdirSync(rollback);copyFileSync(backup,join(rollback,'hermo.sqlite'));const restored=openStore(rollback);try{assert.equal(restored.unseal(restored.db.prepare("SELECT payload FROM connections WHERE id='conn_old'").get().payload).identity.text,'Existing account');assert.equal(restored.unseal(restored.getSetting('sentinel')).value,'saved-private-data');}finally{restored.close();}
  }finally{await instance.app.close();}
  const next=await createApp({port:4393,dataDir:directory});try{assert.equal(next.store.db.prepare('SELECT count(*) n FROM browser_workspaces').get().n,1);}finally{await next.app.close();}
  const one=normalChromeArguments(directory,{workspace_id:'browser_'+'a'.repeat(24),url:'https://example.com/'}),two=normalChromeArguments(directory,{workspace_id:'browser_'+'b'.repeat(24),url:'https://example.com/'});assert.notEqual(one[0],two[0]);assert.throws(()=>normalChromeArguments(directory,{workspace_id:'../../personal'}));
});

test('saved-browser connection page, website panel, output-only UI/API/MCP, Stop and reconnect',{timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const directory=resolve('work/simplified-live-tests',randomBytes(6).toString('hex')),port=4392;
  const launches=[];const {app,origin,store}=await createApp({port,dataDir:directory,normalBrowserLauncher:async options=>launches.push(options)});
  app.get('/sandbox/weather',async(_,reply)=>reply.type('text/html').send('<!doctype html><meta charset="utf-8"><title>Weather fixture</title><h1>Weather</h1><a href="/login">Sign in</a><p id="place">Colombo</p><output id="temperature">28 °C</output><p id="condition">Cloudy</p>'));
  await app.listen({port,host:'127.0.0.1'});let context,cookie='',csrf='',controllerTarget;
  const call=async(path,body,extra={})=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...cookie?{cookie}:{},...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...extra},body:body===undefined?undefined:JSON.stringify(body)});const set=response.headers.get('set-cookie');if(set?.startsWith('hermo_owner_'))cookie=set.split(';')[0];return {status:response.status,value:await response.json()};};
  const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.value;};
  const finish=async rid=>{for(let n=0;n<400;n++){const r=await ok('/studio/runs/'+rid);if(['succeeded','failed','cancelled'].includes(r.status))return r;await new Promise(done=>setTimeout(done,100));}throw Error('Run timeout');};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-saved-browser-password'})).csrf;
    const browser=(await ok('/studio/browser-workspaces',{name:'My saved Chrome',kind:'current'})).browser;
    const c=(await ok('/studio/connections',{name:'Weather',url:origin+'/sandbox/weather',access:'public',browser_mode:'connected',browser_workspace_id:browser.id,authorized:true})).connection;
    await t.test('saved browser routes enforce authentication, CSRF, sharing and safe paths',async()=>{
      assert.equal((await call('/studio/browser-workspaces',undefined,{cookie:''})).status,401);
      assert.equal((await call('/studio/browser-workspaces',{name:'No CSRF',kind:'current'},{'x-hermo-csrf':'bad'})).status,403);
      assert.equal((await call(`/studio/browser-workspaces/${browser.id}/remove`,{authorized:true})).value.error.code,'BROWSER_IN_USE');
      assert.equal((await call(`/studio/browser-workspaces/${browser.id}/open`,{})).value.error.code,'USE_CURRENT_BROWSER');
      await ok(`/studio/browser-workspaces/${browser.id}/rename`,{name:'Work Chrome'});assert.equal((await ok('/studio/browser-workspaces')).browsers[0].name,'Work Chrome');
    });
    await t.test('managed browsers reopen the saved website and delete only their own profile',async()=>{
      const managed=(await ok('/studio/browser-workspaces',{name:'Separate browser',kind:'managed'})).browser;const managedApp=(await ok('/studio/connections',{name:'Managed weather',url:origin+'/sandbox/weather',access:'public',browser_mode:'connected',browser_workspace_id:managed.id,authorized:true})).connection;await ok(`/studio/browser-workspaces/${managed.id}/open`,{connection_id:managedApp.id});assert.equal(launches[0].workspace_id,managed.id);assert.equal(launches[0].url,origin+'/sandbox/weather');
      await ok(`/studio/connections/${managedApp.id}/remove`,{authorized:true});const own=join(directory,'browser-workspaces',managed.id);mkdirSync(own,{recursive:true});writeFileSync(join(own,'synthetic-profile'),'fixture only');const neighbor=join(directory,'browser-workspaces','preserve-neighbor');mkdirSync(neighbor,{recursive:true});await ok(`/studio/browser-workspaces/${managed.id}/remove`,{authorized:true,delete_profile:true});assert.equal(existsSync(own),false);assert.equal(existsSync(neighbor),true);
    });
    context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
    const cdp=await context.browser().newBrowserCDPSession(),{id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});
    const evaluate=async(targetId,expression)=>{const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});try{return await new Promise((resolve,reject)=>{const listener=event=>{if(event.sessionId!==sessionId)return;const data=JSON.parse(event.message);if(data.id!==91)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(data.error||data.result?.exceptionDetails)reject(Error(JSON.stringify(data)));else resolve(data.result.result.value);};const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Extension evaluation timeout'));},10000);cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:91,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);});}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}};
    const site=await context.newPage();await site.goto(origin+'/sandbox/weather');
    const extensionHeaders={cookie:'','x-hermo-extension-id':extensionId,origin:'chrome-extension://'+extensionId};
    const pair=async()=>{
      const grant=await ok(`/studio/connections/${c.id}/browser-link`,{authorized:true});
      assert.equal((await call('/companion/browser/pair',{code:grant.code,origin,authorized:true},extensionHeaders)).value.error.code,'COMPANION_UPDATE_REQUIRED','old companion is rejected before consuming code');
      await site.bringToFront();const target=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(x=>x.url===site.url());await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});
      let popup;
      for(let n=0;n<60;n++){
        popup=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url.endsWith('/popup.html'));
        if(popup&&await evaluate(popup.targetId,"document.documentElement.dataset.hermoReady==='true'").catch(()=>false))break;
        await new Promise(done=>setTimeout(done,100));
      }
      assert.ok(popup,'Chrome opens the actual extension popup');
      await evaluate(popup.targetId,"document.querySelector('#open-connection-page').click();true");
      let pageTarget;for(let n=0;n<50;n++){pageTarget=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url.includes('/connect.html#'));if(pageTarget)break;await new Promise(done=>setTimeout(done,100));}assert.ok(pageTarget);
      await new Promise(done=>setTimeout(done,300));await evaluate(pageTarget.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
      for(let n=0;n<70;n++){if((await ok(`/studio/connections/${c.id}/browser-link`)).linked)break;await new Promise(done=>setTimeout(done,100));}assert.equal((await ok(`/studio/connections/${c.id}/browser-link`)).linked,true);
      controllerTarget=(await cdp.send('Target.getTargets')).targetInfos.filter(x=>x.url.includes('/controller.html')).at(-1).targetId;
      await cdp.send('Target.closeTarget',{targetId:pageTarget.targetId});await site.locator('#hermo-connection-panel').waitFor();
    };
    await pair();await ok(`/studio/connections/${c.id}/confirm`,{public_source:true});
    const differentBrowserGrant=await ok(`/studio/connections/${c.id}/browser-link`,{authorized:true});assert.equal((await call('/companion/browser/pair',{code:differentBrowserGrant.code,origin,authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard'],tab_id:2,context_id:'bc_'+crypto.randomUUID()},extensionHeaders)).value.error.code,'WRONG_BROWSER');
    let snapshot=await ok(`/studio/connections/${c.id}/browser`);assert.equal(snapshot.can_confirm,true);assert.equal(snapshot.elements.some(x=>x.label==='Stop'||x.preview?.includes('Hermo connected')),false);
    await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    const ui=await context.newPage(),errors=[];ui.on('pageerror',e=>errors.push(e.message));await ui.goto(origin+'/#connections');await ui.getByRole('heading',{name:'Saved browsers',exact:true}).waitFor();await ui.waitForTimeout(400);await ui.screenshot({path:join(directory,'saved-browsers.png'),fullPage:true});
    await ui.getByRole('button',{name:'Create action for Weather',exact:true}).click();await ui.getByLabel('What should this action do?').selectOption('read');await ui.getByLabel('Action name',{exact:true}).fill('Weather data');await ui.getByLabel('API action ID').fill('weather.read');await ui.getByRole('button',{name:'Start demonstration'}).click();
    for(const [text,name]of [['Colombo','location'],['28 °C','temperature']]){await ui.locator('.output-choice').filter({has:ui.getByText(text,{exact:true})}).first().click({timeout:7000}).catch(async e=>{throw Error(e.message+'\nDetected outputs: '+await ui.locator('.output-list').innerText());});await ui.getByLabel('Output name',{exact:true}).fill(name);await ui.getByRole('button',{name:'Add output',exact:true}).click();await ui.getByText(name==='location'?'1 output':'2 outputs',{exact:true}).waitFor();}
    await ui.getByRole('button',{name:'Define verification'}).click();await ui.screenshot({path:join(directory,'verification.png'),fullPage:true});await ui.getByLabel('temperature',{exact:true}).selectOption('number');await ui.getByLabel('Required unit in temperature (optional)').fill('\u00b0C');await ui.getByLabel('location',{exact:true}).selectOption('contains');await ui.getByLabel('Expected text in location').fill('Colombo');await ui.getByRole('checkbox').check();await ui.getByRole('button',{name:'Save & test action'}).click();
    await ui.getByRole('button',{name:'Run verification'}).click();await ui.getByText('Verified',{exact:true}).first().waitFor({timeout:15000});
    const wf=(await ok('/studio/overview')).workflows.find(w=>w.slug==='weather.read');assert.deepEqual(wf.inputs,{});assert.equal(wf.steps.length,0);assert.equal(wf.effect,'retrieval');assert.equal(wf.tested,true);
    const key=await ok(`/studio/workflows/${wf.id}/publish`,{}),headers={authorization:'Bearer '+key.key,'idempotency-key':'weather-fixed'};
    await t.test('unchanged read data succeeds via REST, consumer and MCP',async()=>{
      for(let n=0;n<2;n++){const run=await finish((await ok('/v1/actions/weather.read/versions/1/runs',{input:{}},{...headers,'idempotency-key':'weather-'+n})).run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.deepEqual(run.result,{location:'Colombo',temperature:'28 °C'});}
      const contract=await ok('/v1/action-contract',undefined,headers);assert.deepEqual(contract.inputs,[]);assert.equal(contract.action,'weather.read');
      const docs=await ok(`/studio/workflows/${wf.id}/openapi`);assert.deepEqual(docs.paths['/v1/actions/weather.read/versions/1/runs'].post.requestBody.content['application/json'].schema.properties.input.required,[]);
      const consumer=await context.newPage();await consumer.goto(origin+'/workflow-data.html?action=weather.read');await consumer.getByLabel('Hermo API key').fill(key.key);await consumer.getByRole('button',{name:'Use this action'}).click();await consumer.getByText('Ready. No input is needed.').waitFor();assert.equal(await consumer.locator('#inputs input').count(),0);await consumer.getByRole('button',{name:'Read data',exact:true}).click();await consumer.getByText('28 °C',{exact:true}).waitFor();assert.match(await consumer.locator('#status').innerText(),/Verified data received/);assert.equal(await consumer.getByLabel('Hermo API key').inputValue(),'');await consumer.screenshot({path:join(directory,'data-app.png'),fullPage:true});await consumer.setViewportSize({width:390,height:844});assert.ok(await consumer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await consumer.close();
      const mcpHeaders={authorization:headers.authorization,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'};
      const tools=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list',params:{}},mcpHeaders);assert.equal(tools.result.tools.find(x=>x.name==='action_weather_read').annotations.readOnlyHint,true);
      const receipt=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'action_weather_read',arguments:{input:{},request_id:'weather-mcp'}}},mcpHeaders);assert.equal((await finish(receipt.result.structuredContent.run_id)).status,'succeeded');
    });
    await t.test('isolated output-only reads share the source, unit and context contract',async()=>{
      const isolated=(await ok('/studio/connections',{name:'Anonymous weather',url:origin+'/sandbox/weather',access:'public',browser_mode:'isolated',authorized:true})).connection;await ok(`/studio/connections/${isolated.id}/open`,{});await ok(`/studio/connections/${isolated.id}/confirm`,{public_source:true});const recording=await ok('/studio/recordings',{connection_id:isolated.id,name:'Anonymous weather data',slug:'weather.anonymous',action_type:'read'});const snapshot=await ok(`/studio/connections/${isolated.id}/browser`);
      for(const [name,text]of [['location','Colombo'],['temperature','28 \u00b0C']]){const field=snapshot.elements.find(e=>e.kind==='output'&&e.preview===text);assert.ok(field);await ok(`/studio/recordings/${recording.id}/output`,{name,element_id:field.id});}
      const draft=(await ok(`/studio/recordings/${recording.id}/finish`,{verifiers:[{kind:'number',output:'temperature',unit:'\u00b0C'},{kind:'contains',output:'location',value:'Colombo'}]})).workflow;assert.deepEqual(draft.inputs,{});assert.deepEqual(draft.steps,[]);
      for(let n=0;n<2;n++){const run=await finish((await ok(`/studio/workflows/${draft.id}/test`,{input:{}})).run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.deepEqual(run.result,{location:'Colombo',temperature:'28 \u00b0C'});assert.ok(run.verification.checks.includes('public_source_origin'));}
    });
    await t.test('wrong context and missing required output fail without stale data',async()=>{
      await site.locator('#temperature').evaluate(el=>el.textContent='28 \u00b0F');
      const wrongUnit=await finish((await ok('/v1/actions/weather.read/versions/1/runs',{input:{}},{...headers,'idempotency-key':'wrong-weather-unit'})).run_id);assert.equal(wrongUnit.status,'failed');assert.equal(wrongUnit.error.verification.reason,'unit_mismatch');assert.equal(wrongUnit.result,undefined);
      await site.locator('#temperature').evaluate(el=>el.textContent='28 \u00b0C');
      await site.locator('#place').evaluate(el=>el.textContent='London');
      const mismatch=await finish((await ok('/v1/actions/weather.read/versions/1/runs',{input:{}},{...headers,'idempotency-key':'wrong-weather-context'})).run_id);assert.equal(mismatch.status,'failed');assert.equal(mismatch.error.verification.reason,'context_mismatch');assert.equal(mismatch.result,undefined);
      await site.locator('#place').evaluate(el=>el.textContent='Colombo');await site.locator('#temperature').evaluate(el=>el.remove());
      const missing=await finish((await ok('/v1/actions/weather.read/versions/1/runs',{input:{}},{...headers,'idempotency-key':'missing-weather-output'})).run_id);assert.equal(missing.status,'failed');assert.equal(missing.error.verification.reason,'missing_output');assert.equal(missing.result,undefined);
      await site.reload();
    });
    await t.test('panel survives reload, Stop cancels queued work and reconnect retains keys and definitions',async()=>{
      await site.reload();await site.locator('#hermo-connection-panel').waitFor({timeout:10000});await ok(`/studio/connections/${c.id}/browser`);
      const pending=await ok('/v1/actions/weather.read/versions/1/runs',{input:{}},{...headers,'idempotency-key':'stop-queued'});
      await site.bringToFront();const box=await evaluate(controllerTarget,"(async()=>{const r=await chrome.scripting.executeScript({target:{tabId:(await chrome.tabs.query({})).find(t=>t.url?.includes('/sandbox/weather')).id},world:'ISOLATED',func:()=>{const b=document.getElementById('hermo-connection-panel').__hermoView.root.querySelector('.stop').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};}});return r[0].result;})()");await site.mouse.click(box.x,box.y);
      for(let n=0;n<60;n++){if(!(await ok(`/studio/connections/${c.id}/browser-link`)).linked)break;await new Promise(done=>setTimeout(done,100));}
      assert.equal((await ok(`/studio/connections/${c.id}/browser-link`)).linked,false);assert.equal((await finish(pending.run_id)).status,'cancelled');assert.equal((await call('/v1/actions/weather.read/versions/1/runs',{input:{}},{...headers,'idempotency-key':'stopped'})).value.error.code,'CONNECTION_STOPPED');
      assert.equal(store.db.prepare('SELECT revoked_at FROM api_keys WHERE id=?').get(key.id).revoked_at,null);assert.equal(store.db.prepare('SELECT status FROM workflows WHERE id=?').get(wf.id).status,'published');assert.equal(await site.locator('#temperature').innerText(),'28 °C');
      await pair();assert.equal((await ok(`/studio/connections/${c.id}/browser-link`)).confirmed,true);assert.equal((await finish((await ok('/v1/actions/weather.read/versions/1/runs',{input:{}},{...headers,'idempotency-key':'reconnected'})).run_id)).status,'succeeded');
      await ok(`/studio/connections/${c.id}/stop`,{});assert.equal((await ok('/studio/browser-workspaces')).browsers[0].apps[0].id,c.id);await ok(`/studio/browser-workspaces/${browser.id}/reset-context`,{authorized:true});assert.equal(store.db.prepare('SELECT revoked_at FROM api_keys WHERE id=?').get(key.id).revoked_at,null);
    });
    assert.deepEqual(errors,[]);await ui.close();
  }finally{await context?.close();await app.close();}
  const restarted=await createApp({port,dataDir:directory});try{assert.equal(restarted.store.db.prepare('SELECT count(*) n FROM browser_workspaces').get().n,1);assert.equal(restarted.store.db.prepare("SELECT name FROM connections").get().name,'Weather');assert.equal(restarted.store.db.prepare("SELECT status FROM workflows WHERE slug='weather.read'").get().status,'published');}finally{await restarted.app.close();}
});
