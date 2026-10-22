import test from 'node:test';

import assert from 'node:assert/strict';

import {randomBytes} from 'node:crypto';

import {resolve} from 'node:path';

import {chromium} from 'playwright';

import {createApp} from '../server/index.mjs';

import {isBrowserCompanionRequest} from '../server/connected-browser.mjs';

import {richChatFixture} from './rich-chat-fixture.mjs';

import {repairChatDefinition} from '../server/repair-chat.mjs';

import {recordedPaths} from './recorded-chat-layout.mjs';



test('companion exception is confined to extension POSTs on four exact routes',()=>{

 const id='a'.repeat(32),headers={'x-hermo-extension-id':id,origin:'chrome-extension://'+id};

 assert.equal(isBrowserCompanionRequest({method:'POST',headers},'/companion/browser/pair'),true);

 for(const path of ['/studio/session','/companion/browser/pair/','/v1/actions/test'])assert.equal(isBrowserCompanionRequest({method:'POST',headers},path),false);

 assert.equal(isBrowserCompanionRequest({method:'GET',headers},'/companion/browser/pair'),false);

 assert.equal(isBrowserCompanionRequest({method:'POST',headers:{...headers,origin:'https://evil.example'}},'/companion/browser/pair'),false);

});



test('real Chrome selected-tab pairing, recording, REST/MCP and privacy boundaries',{timeout:180000},async t=>{

 process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');

 const port=4346,{app,origin,store}=await createApp({port,dataDir:resolve('work/connected-tests',randomBytes(6).toString('hex'))});

 await app.listen({port,host:'127.0.0.1'});

 let browser,cdp,cookie='',csrf='',connection,wf,key,controllerTarget;

 const password='synthetic-selected-tab-password';

 const call=async(path,body,extra={})=>{

  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...cookie?{cookie}:{},...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...extra},body:body===undefined?undefined:JSON.stringify(body)});

  const set=response.headers.get('set-cookie');if(set?.startsWith('hermo_owner_'))cookie=set.split(';')[0];

  return {status:response.status,value:await response.json()};

 };

 // This fixture owner explicitly reviews and authorizes configured publication changes.
 const ok=async(...args)=>{if(args[1]!==undefined&&/^\/studio\/workflows\/[^/]+\/publish$/.test(args[0])){const review=await ok(args[0].replace(/\/publish$/,'/permissions'));args[1]={expected_version:review.version,permission_fingerprint:review.fingerprint,...(review.changes?.breaking?{change_fingerprint:review.changes.fingerprint,accept_breaking:true}:{}),...args[1]};}const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.value;};

 const snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);

 const finish=async id=>{for(let n=0;n<120;n++){const run=await ok('/studio/runs/'+id);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(r=>setTimeout(r,100));}throw Error('Run did not finish');};

 // Chrome's documented extension testing protocol runs solely in an empty disposable profile.

 async function evaluateTarget(targetId,expression){

  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});

  try{return await new Promise((resolve,reject)=>{

   const requestId=1,listener=event=>{if(event.sessionId!==sessionId)return;const data=JSON.parse(event.message);if(data.id!==requestId)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(data.error||data.result?.exceptionDetails)reject(Error(JSON.stringify(data)));else resolve(data.result.result.value);};

   const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Extension test evaluation timed out'));},15000);

   cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:requestId,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);

  });}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}

 }

 try{

  csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password})).csrf;

  await t.test('explicit owner approval, CSRF, selected public tabs and closed-link behavior',async()=>{

   assert.equal((await call('/studio/connections',{name:'Public tab',url:'https://example.com',access:'public',browser_mode:'connected',authorized:true})).status,200);

   connection=(await ok('/studio/connections',{name:'Normal Chrome',url:origin+'/sandbox/orders',browser_mode:'connected',authorized:true})).connection;

   const legacy={steps:[],inputs:{},outputs:[],verifiers:[],effect:'retrieval',version:'legacy-fixture'};

   store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_legacy',connection.id,'Legacy fixture','legacy.fixture','published',legacy.version,store.seal(legacy),legacy.version,new Date().toISOString());

   assert.equal((await call(`/studio/connections/${connection.id}/open`,{})).value.error.code,'BROWSER_LINK_REQUIRED');

   assert.equal((await call(`/studio/connections/${connection.id}/browser-link`,{password,authorized:true},{'x-hermo-csrf':'bad'})).status,403);

   assert.equal((await call(`/studio/connections/${connection.id}/browser-link`,{password:'wrong',authorized:true})).status,401);

   assert.equal((await call(`/studio/connections/${connection.id}/browser-link`,{password,authorized:false})).status,400);

  });

  const context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});browser=context;

  cdp=await context.browser().newBrowserCDPSession();const {id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});

  const website=await context.newPage();await website.goto(origin+'/sandbox/');

  await website.getByLabel('Email').fill('alex@northstar.example');await website.getByLabel('Password').fill('demo-only-local');await website.getByRole('button',{name:'Sign in',exact:true}).click();await website.waitForURL('**/sandbox/orders');

  const grant=await ok(`/studio/connections/${connection.id}/browser-link`,{password,authorized:true});

  const extHeaders={cookie:'',origin:'chrome-extension://'+extensionId,'x-hermo-extension-id':extensionId};

  assert.equal((await call('/companion/browser/pair',{code:grant.code,origin:'https://wrong.example',authorized:true},extHeaders)).status,403);

  assert.equal((await call('/companion/browser/pair',{code:grant.code,origin,authorized:true},{...extHeaders,origin:'https://evil.example'})).status,403);

  await t.test('production extension popup attaches the already signed-in selected tab',async()=>{

   const targets=await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});const tab=targets.targetInfos.find(x=>x.url===website.url());assert.ok(tab);

   await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});

   await new Promise(r=>setTimeout(r,750));

   const popup=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url.endsWith('/popup.html'));assert.ok(popup);

   const loaded=await evaluateTarget(popup.targetId,"({url:location.href,html:document.body?.innerHTML})");assert.ok(loaded.html?.includes('id=\"workspace\"'),JSON.stringify(loaded));

   await evaluateTarget(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);

   for(let n=0;n<50;n++){const linked=await ok(`/studio/connections/${connection.id}/browser-link`);if(linked.linked)break;await new Promise(r=>setTimeout(r,100));}

   const diagnostics=(await cdp.send('Target.getTargets')).targetInfos.filter(x=>/popup.html|controller.html/.test(x.url));

   const messages=[];for(const target of diagnostics)messages.push(await evaluateTarget(target.targetId,"document.body.innerText"));

   assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,true,JSON.stringify(messages));

   const pairedTargets=(await cdp.send('Target.getTargets')).targetInfos;assert.equal(pairedTargets.some(x=>x.url.includes('/controller.html')||x.url.includes('/connect.html')),false,'default pairing creates no extra tab');controllerTarget=pairedTargets.find(x=>x.type==='service_worker'&&x.url.endsWith('/background.mjs'))?.targetId;assert.ok(controllerTarget);

   assert.equal((await call('/companion/browser/pair',{code:grant.code,origin,authorized:true},extHeaders)).status,401,'one-use pairing code');

   const migrated=store.db.prepare('SELECT * FROM workflows WHERE id=?').get('wf_legacy');assert.equal(migrated.status,'published');assert.equal(migrated.version,'legacy-fixture');assert.equal(store.unseal(migrated.payload).effect,'retrieval');assert.equal(migrated.test_version,'legacy-fixture');

   store.db.prepare('DELETE FROM workflows WHERE id=?').run('wf_legacy');

   const paired=(await ok('/studio/overview')).connections.find(c=>c.id===connection.id);assert.equal(paired.browser_linked,true);assert.equal(paired.display_status,'connected');assert.equal(paired.status,'connected');assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).confirmed,true);

   await ok(`/studio/connections/${connection.id}/open`,{});const snap=await snapshot();assert.equal(snap.mode,'connected');assert.equal(snap.can_confirm,true);

   await website.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<span id="invalid-account-marker">New chat</span>'));

   const invalid=(await snapshot()).elements.find(x=>x.preview==='New chat');assert.ok(invalid);assert.equal(invalid.identity_eligible,false);

   await ok(`/studio/connections/${connection.id}/confirm`,{element_id:invalid.id});

   const selectedBinding=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id).payload).identity;assert.deepEqual(selectedBinding,{kind:'selected_tab',origin});

   await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);

   const confirmationUI=await context.newPage();confirmationUI.setDefaultTimeout(7000);await confirmationUI.goto(origin+'/#connections');

   const card=confirmationUI.locator('.connection-card').filter({has:confirmationUI.getByRole('heading',{name:'Normal Chrome',exact:true})});

   assert.equal(await card.getByRole('button',{name:'Confirm account',exact:true}).count(),0,'pairing needs no account confirmation');

   await card.getByText('Connected',{exact:true}).waitFor();

   await confirmationUI.reload();await card.getByText('Connected',{exact:true}).waitFor();

   await card.getByRole('button',{name:'Create action for Normal Chrome',exact:true}).click();

   assert.equal(await confirmationUI.getByLabel('Connected app',{exact:true}).inputValue(),connection.id);

   await confirmationUI.getByRole('button',{name:'Cancel',exact:true}).click();await confirmationUI.close();

   assert.equal((await ok('/studio/overview')).connections.find(c=>c.id===connection.id).display_status,'connected');

   const payload=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id).payload);assert.equal(payload.browser_mode,'connected');assert.equal(payload.storageState,undefined);assert.equal(payload.studioState,undefined);

   const pageCount=(await cdp.send('Target.getTargets')).targetInfos.filter(x=>x.type==='page').length;

   await ok(`/studio/connections/${connection.id}/desktop`,{});assert.equal((await cdp.send('Target.getTargets')).targetInfos.filter(x=>x.type==='page').length,pageCount,'show focuses existing tab');

  });

  await t.test('record real controls, validate two results and call generated REST and MCP APIs',async()=>{

   const recording=await ok('/studio/recordings',{connection_id:connection.id,name:'Chrome order lookup',slug:'chrome.orders'});

   let snap=await snapshot();await ok(`/studio/connections/${connection.id}/control`,{element_id:snap.elements.find(x=>x.label==='Order ID').id,kind:'fill',value:'ORD-2041',parameter:'order_id',recording_id:recording.id});

   snap=await snapshot();await ok(`/studio/connections/${connection.id}/control`,{element_id:snap.elements.find(x=>x.label==='Search orders').id,kind:'click',recording_id:recording.id});

   snap=await snapshot();for(const [name,value]of [['order_id','ORD-2041'],['status','Shipped']])await ok(`/studio/recordings/${recording.id}/output`,{element_id:snap.elements.find(x=>x.preview===value).id,name});

   wf=(await ok(`/studio/recordings/${recording.id}/finish`,{verifiers:[{output:'order_id',input:'order_id'}]})).workflow;

   for(const [order,status]of [['ORD-2041','Shipped'],['ORD-2042','Processing']]){const run=await finish((await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:order}})).run_id);assert.equal(run.status,'succeeded',JSON.stringify({run,controller:await evaluateTarget(controllerTarget,"JSON.stringify(globalThis.hermoConnectionStates)")}));assert.deepEqual(run.result,{order_id:order,status});}

   key=await ok(`/studio/workflows/${wf.id}/publish`,{});assert.match(key.key,/^hm_live_/);

   const headers={authorization:'Bearer '+key.key,'idempotency-key':'native-api-test'};

   const receipt=await ok('/v1/actions/chrome.orders/versions/1/runs',{input:{order_id:'ORD-2041'}},headers);assert.equal((await finish(receipt.run_id)).status,'succeeded');

   assert.equal((await ok('/v1/actions/chrome.orders/versions/1/runs',{input:{order_id:'ORD-2041'}},headers)).run_id,receipt.run_id);

   const mcp=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list',params:{}},{authorization:headers.authorization,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});assert.ok(mcp.result.tools.some(x=>x.name==='action_chrome_orders'));

   assert.equal(mcp.result.tools.find(x=>x.name==='action_chrome_orders').annotations.readOnlyHint,false);

   const called=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'action_chrome_orders',arguments:{input:{order_id:'ORD-2042'},request_id:'native-mcp-test'}}},{authorization:headers.authorization,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});assert.equal((await finish(called.result.structuredContent.run_id)).result.status,'Processing');

   assert.match((await ok(`/studio/workflows/${wf.id}/openapi`)).info.description,/may submit forms/);

  });

  await t.test('native UI defaults, connected preview and existing-tab focus have no page errors',async()=>{

   await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);

   const ui=await context.newPage(),errors=[];ui.on('pageerror',error=>errors.push(error.message));await ui.goto(origin+'/#connections');

   await ui.getByRole('button',{name:'Connect app',exact:true}).click();assert.equal(await ui.getByLabel('Browser mode').inputValue(),'connected');await ui.getByRole('button',{name:'Cancel',exact:true}).click();

   await ui.getByRole('button',{name:'Open browser',exact:true}).click();await ui.getByText('Your selected Chrome tab',{exact:true}).waitFor();await ui.getByRole('button',{name:'Show connected tab',exact:true}).waitFor({state:'visible'});

   await ui.getByRole('button',{name:'Website',exact:true}).waitFor();assert.equal(await ui.locator('.browser-dom-preview').count(),0,'the real website view is the default');await ui.getByRole('button',{name:'Detected fields',exact:true}).click();await ui.locator('.browser-dom-preview').waitFor({state:'visible'});assert.equal(await ui.getByText('Connect your ChatGPT plan',{exact:true}).count(),0);assert.equal(await ui.locator('.browser-dom-preview').count(),1);assert.equal(await ui.locator('.browser-preview img').count(),0);

   await ui.getByRole('button',{name:'Show connected tab',exact:true}).click();assert.match(website.url(),/sandbox\/orders/);assert.deepEqual(errors,[]);await ui.close();

  });

  await t.test('activeTab works on a separate website after the popup closes and the website reloads',async t=>{

   // Intercept a synthetic external-origin page: loopback host permissions cannot

   // hide a broken activeTab handoff here. No real account or website data is read.

   const siteOrigin='https://example.com';

   let chatHTML=(await richChatFixture()).replace('<h1 id="account">Synthetic external account</h1>','');

   await context.route(siteOrigin+'/**',route=>route.fulfill({contentType:'text/html',body:chatHTML}));

   const external=await context.newPage();external.setDefaultTimeout(7000);await external.goto(siteOrigin+'/');

   const other=(await ok('/studio/connections',{name:'External tab',url:siteOrigin,browser_mode:'connected',authorized:true})).connection;

   const otherGrant=await ok(`/studio/connections/${other.id}/browser-link`,{password,authorized:true});

   const tabs=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos;

   const target=tabs.find(x=>x.url===external.url());assert.ok(target);

   await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});await new Promise(r=>setTimeout(r,500));

   const popup=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url.endsWith('/popup.html'));assert.ok(popup);

   await evaluateTarget(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(otherGrant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);

   for(let n=0;n<100;n++){if((await ok(`/studio/connections/${other.id}/browser-link`)).linked)break;await new Promise(r=>setTimeout(r,100));}

   assert.equal((await ok(`/studio/connections/${other.id}/browser-link`)).linked,true);

   await cdp.send('Target.closeTarget',{targetId:popup.targetId});

   await external.reload();

   const snap=await ok(`/studio/connections/${other.id}/browser`);

   assert.equal(snap.can_confirm,true);assert.equal(snap.elements.some(x=>x.identity_eligible),false,'the signed-in website exposes no profile name or email');

   const connected=(await ok('/studio/overview')).connections.find(c=>c.id===other.id);assert.equal(connected.display_status,'connected');assert.equal(connected.status,'connected');

   assert.deepEqual(store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(other.id).payload).identity,{kind:'selected_tab',origin:siteOrigin});

   const staleUI=await context.newPage();staleUI.setDefaultTimeout(7000);

   const browserPath=`**/studio/connections/${other.id}/browser`;

   await staleUI.route(browserPath,route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'BROWSER_TAB_UNAVAILABLE',message:'Synthetic transient page read failure.'}})}));

   await staleUI.goto(origin+'/#connections');

   await staleUI.locator('.connection-card').filter({has:staleUI.getByRole('heading',{name:'External tab',exact:true})}).getByRole('button',{name:'Open browser',exact:true}).click();

   await staleUI.getByText('Your selected Chrome tab',{exact:true}).waitFor();

   assert.equal(await staleUI.getByText('Google sign-in in this private browser',{exact:true}).count(),0,'a transient native preview failure never displays the isolated profile');

   await staleUI.getByText('Synthetic transient page read failure.',{exact:true}).waitFor();

   await staleUI.unroute(browserPath);

   await staleUI.getByRole('button',{name:'Detected fields',exact:true}).click();await staleUI.locator('.browser-dom-preview').waitFor({timeout:7000}).catch(async error=>{await staleUI.screenshot({path:'work/no-account-transient-preview.png',fullPage:true});throw Error(error.message+'\nBODY: '+await staleUI.locator('body').innerText()+'\nPREVIEW: '+await staleUI.locator('.browser-preview').innerHTML());});

   assert.equal(await staleUI.getByRole('button',{name:'Account marker',exact:true}).count(),0);

   assert.equal(await staleUI.getByRole('button',{name:'Confirm this account',exact:true}).count(),0,'a transient preview error does not reintroduce profile confirmation');

   await staleUI.getByRole('button',{name:'Close dialog',exact:true}).click();

   await staleUI.getByRole('button',{name:'Actions',exact:true}).click();

   await staleUI.getByRole('button',{name:'Create action',exact:true}).click();

   const picker=staleUI.getByLabel('Connected app',{exact:true});

   await picker.waitFor({timeout:7000}).catch(async error=>{throw Error(error.message+'\n'+await staleUI.locator('body').innerText());});

   const appOptions=await picker.locator('option').allTextContents();assert.ok(appOptions.includes('External tab'),'the paired private website is immediately ready: '+JSON.stringify(appOptions));

   await picker.selectOption(other.id);

   await staleUI.getByRole('button',{name:'Start demonstration',exact:true}).waitFor();

   assert.equal(await staleUI.getByRole('button',{name:'Account marker',exact:true}).count(),0,'a website without a profile marker can begin recording');

   assert.equal(await picker.locator('option:checked').textContent(),'External tab');

   await staleUI.getByRole('button',{name:'Cancel',exact:true}).click();

   await staleUI.getByRole('button',{name:'Connections',exact:true}).click();

   const readyCard=staleUI.locator('.connection-card').filter({has:staleUI.getByRole('heading',{name:'External tab',exact:true})});

   await readyCard.getByText('Connected',{exact:true}).waitFor();

   await readyCard.getByRole('button',{name:'Open browser',exact:true}).click();

   await staleUI.getByRole('button',{name:'Detected fields',exact:true}).click();await staleUI.locator('.browser-dom-preview').waitFor();

   assert.equal(await staleUI.getByRole('button',{name:'Confirm this account',exact:true}).count(),0);

   await staleUI.getByRole('button',{name:'Close dialog',exact:true}).click();

   await staleUI.reload();

   await readyCard.getByText('Connected',{exact:true}).waitFor();

   assert.equal(await readyCard.getByRole('button',{name:'Confirm account',exact:true}).count(),0,'paired connectivity survives close and reload without account confirmation');

   await staleUI.close();

   const pageCount=(await cdp.send('Target.getTargets')).targetInfos.filter(x=>x.type==='page').length;

   await ok(`/studio/connections/${other.id}/desktop`,{});

   assert.equal((await cdp.send('Target.getTargets')).targetInfos.filter(x=>x.type==='page').length,pageCount);

   await t.test('record rich chat in the UI, wait for completed fresh replies and return them through REST/MCP',async t=>{

    const latest=await ok(`/studio/connections/${other.id}/browser`);

    assert.ok(latest.elements.some(x=>x.label==='Ask Chat'&&x.type==='editor'));

    assert.equal(latest.elements.some(x=>x.identity_eligible),false,'recording does not depend on profile detection');

    const ui=await context.newPage(),errors=[];ui.setDefaultTimeout(7000);ui.on('pageerror',error=>errors.push(error.message));await ui.goto(origin+'/#connections');

    await ui.getByRole('button',{name:'Create action for External tab',exact:true}).click();

    await ui.getByLabel('Action name',{exact:true}).fill('Rich chat fixture');await ui.getByLabel('API action ID').fill('chat.fixture');await ui.getByRole('button',{name:'Start demonstration',exact:true}).click();

    const input=ui.getByLabel('Ask Chat',{exact:true});await input.waitFor();assert.equal(await input.evaluate(el=>el.tagName),'TEXTAREA');

    await input.fill('alpha');await ui.getByRole('button',{name:'Fill field',exact:true}).click();

    await ui.getByText('1 input',{exact:true}).waitFor();assert.equal(await external.evaluate(()=>window.fixtureModel),'alpha');

    await ui.getByRole('button',{name:'Detected fields',exact:true}).click();await ui.locator('.connected-message').filter({has:ui.getByText('Message draft',{exact:true})}).getByText('alpha',{exact:true}).waitFor();

    await ui.getByRole('button',{name:'Send message',exact:true}).click();await external.getByText('Answer for alpha',{exact:true}).waitFor();

    await ui.locator('.connected-message.assistant').getByText(/Answer for alpha/).waitFor();

    await external.locator('[data-message-author-role="assistant"]').last().evaluate(el=>el.append(' Updated in Chrome.'));

    await ui.locator('.connected-message.assistant').getByText(/Updated in Chrome/).waitFor();

    assert.equal(await ui.getByRole('button',{name:'Send message',exact:true}).count(),1,'background updates retain the detected controls');

    await ui.getByRole('button',{name:'Outputs',exact:true}).click();

    for(const [label,name]of [['Latest submitted message','prompt_echo'],['Latest assistant response','response']]){

      await ui.locator('.output-choice').filter({has:ui.getByText(label,{exact:true})}).click();assert.equal(await ui.getByLabel('Output name',{exact:true}).inputValue(),name);await ui.getByRole('button',{name:'Add output',exact:true}).click();

    }

    await ui.getByText('2 outputs',{exact:true}).waitFor();await ui.getByRole('button',{name:'Define verification',exact:true}).click();

    await ui.getByRole('checkbox').check();await ui.getByRole('button',{name:'Save & test action',exact:true}).click();

    let chat;for(let n=0;n<50;n++){chat=(await ok('/studio/overview')).workflows.find(x=>x.slug==='chat.fixture');if(chat)break;await new Promise(r=>setTimeout(r,100));}assert.ok(chat);

    for(const prompt of ['alpha','beta']){const run=await finish((await ok(`/studio/workflows/${chat.id}/test`,{input:{prompt}})).run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.result.prompt_echo,prompt);assert.match(run.result.response,new RegExp('Answer for '+prompt));assert.match(run.result.response,/Ready to use/);assert.equal(/Partial|Older/.test(run.result.response),false);}

    await t.test('failed replay identifies the exact missing step and retains its progress',async()=>{

      const row=store.db.prepare('SELECT * FROM workflows WHERE id=?').get(chat.id),definition=store.unseal(row.payload);

      definition.steps.push({op:'click',selector:'#missing-after-send'});

      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_missing_step',row.connection_id,'Missing step fixture','chat.missing-step','draft',row.version,store.seal(definition),null,new Date().toISOString());

      const failed=await finish((await ok('/studio/workflows/wf_missing_step/test',{input:{prompt:'missing-step-test'}})).run_id);

      assert.equal(failed.status,'failed');assert.equal(failed.error.code,'ACTION_UNAVAILABLE');

      assert.match(failed.error.message,/step 3 of 3 \(click\)/);assert.equal(failed.progress,67);

      assert.equal(failed.current_step.number,3);

    });

    await t.test('hidden profiles permit replay and draft chat repair keeps its action ID',async t=>{

      assert.equal(await external.locator('#account').count(),0);

      const replay=await finish((await ok(`/studio/workflows/${chat.id}/test`,{input:{prompt:'hidden-profile-check'}})).run_id);

      assert.equal(replay.status,'succeeded',JSON.stringify(replay));assert.equal(replay.result.prompt_echo,'hidden-profile-check');assert.match(replay.result.response,/Answer for hidden-profile-check/);assert.ok(replay.verification.checks.includes('selected_tab_origin'));

      assert.equal((await ok('/studio/overview')).connections.find(c=>c.id===other.id).display_status,'connected');

      const row=store.db.prepare('SELECT * FROM workflows WHERE id=?').get(chat.id),d=store.unseal(row.payload);

      d.steps.push({op:'click',selector:'[aria-label="Copy"]'});d.outputs=d.outputs.map(x=>({...x,selector:'#old-conversation-paragraph',read_mode:undefined}));

      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_repair_chat',row.connection_id,'Repair chat fixture','chat.repair.fixture','draft',row.version,store.seal(d),row.version,new Date().toISOString());

      assert.equal((await call('/studio/workflows/wf_repair_chat/repair-chat',{authorized:true},{'x-hermo-csrf':'bad'})).status,403);

      assert.equal((await call('/studio/workflows/wf_repair_chat/repair-chat',{authorized:false})).status,400);

      const repairUI=await context.newPage();repairUI.setDefaultTimeout(7000);await repairUI.goto(origin+'/#actions');

      const card=repairUI.locator('.action-card').filter({has:repairUI.getByRole('heading',{name:'Repair chat fixture',exact:true})});

      await card.getByRole('button',{name:'Test action',exact:true}).click();await repairUI.getByText('Repair this chat recording',{exact:true}).click();

      await repairUI.getByRole('checkbox',{name:'I authorize replacing this draft recording with these two steps and retesting it.',exact:true}).check();await repairUI.getByRole('button',{name:'Repair chat recording',exact:true}).click();

      await repairUI.getByText('Recording repaired. Run verification with a different prompt before publishing.',{exact:true}).waitFor();

      const repaired=(await ok('/studio/overview')).workflows.find(x=>x.id==='wf_repair_chat');assert.equal(repaired.slug,'chat.repair.fixture');assert.equal(repaired.steps.length,2);assert.equal(repaired.tested,false);assert.notEqual(repaired.version,row.version);

      const result=await finish((await ok('/studio/workflows/wf_repair_chat/test',{input:{prompt:'repaired-request'}})).run_id);

      assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.result.prompt_echo,'repaired-request');assert.match(result.result.response,/Answer for repaired-request/);

      await t.test('repair on an empty chat does not navigate or submit and subsequent verification sends a fresh message',async()=>{

        await external.locator('#messages').evaluate(el=>el.replaceChildren());

        const urlBefore=external.url(),draftBefore=await external.evaluate(()=>window.fixtureModel);

        await ok('/studio/workflows/wf_repair_chat/repair-chat',{authorized:true});

        assert.equal(external.url(),urlBefore,'repair only reads the selected page');

        assert.equal(await external.evaluate(()=>window.fixtureModel),draftBefore);

        assert.equal(await external.locator('#messages').locator('div').count(),0,'repair never submits a prompt');

        const replay=await finish((await ok('/studio/workflows/wf_repair_chat/test',{input:{prompt:'empty-chat-repaired-request'}})).run_id);

        assert.equal(replay.status,'succeeded',JSON.stringify(replay));

        assert.equal(replay.result.prompt_echo,'empty-chat-repaired-request');assert.match(replay.result.response,/Answer for empty-chat-repaired-request/);

        assert.equal(replay.current_step.total,2);

      });

      const publishedState=store.db.prepare('SELECT status FROM workflows WHERE id=?').get(chat.id);assert.equal(publishedState.status,'draft');

      await repairUI.close();

    });

    await t.test('selected-tab binding survives sidebar changes and uses the currently signed-in account',async()=>{

      const previousHTML=chatHTML;

      const base=await richChatFixture({legacy:true});

      const fixture=changed=>base.replace('<h1 id="account">Synthetic external account</h1>','<aside id="app-shell-sidebar"><div><span>Synthetic external account</span></div></aside>')+`<script>document.querySelector('#send').addEventListener('click',()=>{document.querySelector('#app-shell-sidebar').innerHTML='<div>Sidebar updated</div><div><button aria-label="Open profile menu"><span>${changed?'Different external account':'Synthetic external account'}</span></button></div>';});</script>`;

      try{

        for(const changed of [false,true]){

          chatHTML=fixture(changed);await external.goto(siteOrigin+'/');

          const run=await finish((await ok(`/studio/workflows/${chat.id}/test`,{input:{prompt:changed?'changed-owner-request':'shifted-sidebar-request'}})).run_id);

          const prompt=changed?'changed-owner-request':'shifted-sidebar-request';assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.result.prompt_echo,prompt);assert.match(run.result.response,new RegExp('Answer for '+prompt));assert.ok(run.verification.checks.includes('selected_tab_origin'));

          assert.equal((await ok('/studio/overview')).connections.find(c=>c.id===other.id).display_status,'connected');

          assert.deepEqual(store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(other.id).payload).identity,{kind:'selected_tab',origin:siteOrigin});

        }

      }finally{

        chatHTML=previousHTML;await external.goto(siteOrigin+'/');



      }

    });

    await t.test('existing recorded role-selector action returns full fresh replies after message-role attributes disappear',async()=>{

      const previousHTML=chatHTML;chatHTML=await richChatFixture({legacy:true});

      try{

        const run=await finish((await ok(`/studio/workflows/${chat.id}/test`,{input:{prompt:'legacy-layout-request'}})).run_id);

        assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.result.prompt_echo,'legacy-layout-request');assert.match(run.result.response,/Answer for legacy-layout-request/);assert.match(run.result.response,/Ready to use/);assert.doesNotMatch(run.result.response,/Copy|Like|Partial/);

        const snap=await ok(`/studio/connections/${other.id}/browser`);assert.ok(snap.elements.some(x=>x.label==='Latest assistant response'));assert.ok(snap.elements.some(x=>x.label==='Latest submitted message'));

      }finally{chatHTML=previousHTML;}

    });

    await t.test('deep legacy chat keeps one conversation across repeated prompts and returns full verified REST and MCP replies',async()=>{

      const previousHTML=chatHTML;chatHTML=await richChatFixture({legacy:true,deepLegacy:true});

      try{

        await external.goto(siteOrigin+'/chat/existing');

        await ok('/studio/workflows/wf_repair_chat/repair-chat',{authorized:true});

        let conversationURL;

        for(let index=0;index<2;index++){

          const replay=await finish((await ok('/studio/workflows/wf_repair_chat/test',{input:{prompt:'same repeated prompt'}})).run_id);

          assert.equal(replay.status,'succeeded',JSON.stringify(replay));assert.equal(replay.result.prompt_echo,'same repeated prompt');assert.match(replay.result.response,/Answer for same repeated prompt/);assert.match(replay.result.response,/Ready to use/);

          assert.equal(replay.current_step.total,2);assert.equal(await external.evaluate(()=>window.fixtureSendCount),index+1,'each replay sends exactly once and preserves earlier turns');

          if(index===0)conversationURL=external.url();else assert.equal(external.url(),conversationURL,'subsequent Send stays in the same conversation');

        }

        const key=await ok('/studio/workflows/wf_repair_chat/publish',{}),auth={authorization:'Bearer '+key.key};

        const rest=await finish((await ok('/v1/actions/chat.repair.fixture/versions/1/runs',{input:{prompt:'continued REST request'}},{...auth,'idempotency-key':'continued-rest'})).run_id);

        assert.equal(rest.status,'succeeded',JSON.stringify(rest));assert.equal(rest.result.prompt_echo,'continued REST request');assert.match(rest.result.response,/Answer for continued REST request/);

        const mcp=await ok('/mcp',{jsonrpc:'2.0',id:20,method:'tools/call',params:{name:'action_chat_repair_fixture',arguments:{input:{prompt:'continued MCP request'},request_id:'continued-mcp'}}},{...auth,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});

        const run=await finish(mcp.result.structuredContent.run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.result.prompt_echo,'continued MCP request');assert.match(run.result.response,/Answer for continued MCP request/);

        assert.equal(external.url(),conversationURL);assert.equal(await external.evaluate(()=>window.fixtureSendCount),4);assert.equal(await external.locator('#messages button[aria-label="Copy message"]').count(),4);

      }finally{chatHTML=previousHTML;await external.goto(siteOrigin+'/');}

    });

    await t.test('recorded structure returns completed replies through the existing extension, REST and MCP without toolbar heuristics',async()=>{

      const previousHTML=chatHTML;

      try{

       for(const mode of ['grouped','flat']){

        chatHTML=await richChatFixture({recordedLegacy:true,recordedFlat:mode==='flat'});

        await external.goto(siteOrigin+'/chat/existing');

        const wid='wf_recorded_'+mode,slug='chat.recorded.'+mode;

        await external.evaluate(()=>{window.fixtureTrimPrompt=true;document.querySelector('#messages').style.whiteSpace='pre-wrap';});

        const row=store.db.prepare('SELECT * FROM workflows WHERE id=?').get(chat.id),old=store.unseal(row.payload);

        const definition=repairChatDefinition({...old,steps:old.steps.filter(x=>x.op!=='navigate'),chat_recording:recordedPaths},[{kind:'input',type:'editor',selector:old.steps.find(x=>x.op==='fill').selector}],{url:'https://chatgpt.com/c/owned-fixture'});

        assert.deepEqual(definition.chat_recording,recordedPaths,'exercise the recorded structure, not the role-selector fallback');

        store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,row.connection_id,'Recorded '+mode+' fixture',slug,'draft','recorded-structure-test',store.seal({...definition,version:'recorded-structure-test'}),null,new Date().toISOString());

        let conversationURL;

        assert.equal((await call('/studio/workflows/'+wid+'/test',{input:{prompt:' \n\t '}})).status,400);

        assert.equal(await external.evaluate(()=>window.fixtureSendCount??0),0,'blank normalized prompts never click Send');

        for(let index=0;index<2;index++){

          const prompt=index===0?'\nhi':' \nFirst line\n\n  indented code\nLast line\n ';

          const run=await finish((await ok('/studio/workflows/'+wid+'/test',{input:{prompt}})).run_id);

          assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.input.prompt,prompt.trim());assert.equal(run.result.prompt_echo,prompt.trim());assert.equal(run.result.response,'Answer for '+prompt.trim()+'\n\nReady to use.');

          assert.equal(run.current_step.total,2);assert.equal(await external.evaluate(()=>window.fixtureSendCount),index+1);

          if(!index)conversationURL=external.url();else assert.equal(external.url(),conversationURL);

        }

        const key=await ok('/studio/workflows/'+wid+'/publish',{}),auth={authorization:'Bearer '+key.key};

        const restReceipt=await ok('/v1/actions/'+slug+'/versions/1/runs',{input:{prompt:'\nrecorded REST\n '}},{...auth,'idempotency-key':'recorded-rest'});

        const rest=await finish(restReceipt.run_id);

        assert.equal(rest.status,'succeeded',JSON.stringify(rest));assert.equal(rest.result.prompt_echo,'recorded REST');assert.equal(rest.result.response,'Answer for recorded REST\n\nReady to use.');

        const retry=await ok('/v1/actions/'+slug+'/versions/1/runs',{input:{prompt:'recorded REST'}},{...auth,'idempotency-key':'recorded-rest'});

        assert.equal(retry.run_id,restReceipt.run_id);assert.equal(retry.reused,true,'normalization precedes idempotency hashing');

        const mcp=await ok('/mcp',{jsonrpc:'2.0',id:21,method:'tools/call',params:{name:'action_'+slug.replaceAll('.','_'),arguments:{input:{prompt:'\nrecorded MCP\n'},request_id:'recorded-mcp'}}},{...auth,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});

        const run=await finish(mcp.result.structuredContent.run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.result.prompt_echo,'recorded MCP');assert.equal(run.result.response,'Answer for recorded MCP\n\nReady to use.');

        assert.equal(await external.evaluate(()=>window.fixtureSendCount),4);assert.equal(external.url(),conversationURL);

       }

      }finally{chatHTML=previousHTML;await external.goto(siteOrigin+'/');}

    });

    const published=await ok(`/studio/workflows/${chat.id}/publish`,{}),headers={authorization:'Bearer '+published.key,'idempotency-key':'rich-chat-rest'};

    const run=await finish((await ok('/v1/actions/chat.fixture/versions/1/runs',{input:{prompt:'gamma'}},headers)).run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.match(run.result.response,/Answer for gamma/);

    const mcp=await ok('/mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'action_chat_fixture',arguments:{input:{prompt:'delta'},request_id:'rich-chat-mcp'}}},{authorization:headers.authorization,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});

    assert.match((await finish(mcp.result.structuredContent.run_id)).result.response,/Answer for delta/);

    await t.test('chat consumer app uses the generated key and reports revoked access',async()=>{

      const consumer=await context.newPage();consumer.setDefaultTimeout(12000);consumer.on('pageerror',error=>errors.push(error.message));await consumer.goto(origin+'/workflow-chat.html?action=chat.fixture');

      await consumer.getByLabel('Hermo API key',{exact:true}).fill(published.key);await consumer.getByRole('button',{name:'Use this action',exact:true}).click();

      assert.equal(await consumer.getByLabel('Hermo API key',{exact:true}).inputValue(),'');

      await consumer.getByLabel('Message',{exact:true}).fill('consumer request');await consumer.getByRole('button',{name:'Send message',exact:true}).click();

      await consumer.getByText('Verified response received.',{exact:true}).waitFor();assert.match(await consumer.locator('.message.assistant').last().innerText(),/Answer for consumer request/);

      assert.equal(await consumer.evaluate(()=>localStorage.length+sessionStorage.length),0);

      await ok(`/studio/keys/${published.id}/revoke`,{});

      await consumer.getByLabel('Message',{exact:true}).fill('revoked request');await consumer.getByRole('button',{name:'Send message',exact:true}).click();await consumer.locator('.message.error').waitFor();assert.match(await consumer.locator('.message.error').innerText(),/valid scoped Hermo API key/);

      await consumer.close();

    });

    await external.bringToFront();const visual=await ok(`/studio/connections/${other.id}/browser`);assert.equal(visual.image,'','connecting a tab never implicitly grants visual capture');assert.equal(visual.preview.state,'disabled');

    await t.test('removal requires intent, blocks live runs and deletes only the selected connection',async()=>{

      assert.equal((await call(`/studio/connections/${other.id}/remove`,{authorized:false})).status,400);

      assert.equal((await call(`/studio/connections/${other.id}/remove`,{authorized:true},{'x-hermo-csrf':'bad'})).status,403);

      const removalKey=await ok('/studio/keys',{workflow_id:chat.id,name:'Removal boundary key'}),removalHeaders={authorization:'Bearer '+removalKey.key,'idempotency-key':'removal-boundary'};

      const pending=(await ok('/v1/actions/chat.fixture/versions/1/runs',{input:{prompt:'removal guard'}},removalHeaders)).run_id;

      assert.equal((await call(`/studio/connections/${other.id}/remove`,{authorized:true})).value.error.code,'CONNECTION_BUSY');await finish(pending);assert.equal((await call('/v1/runs/'+pending,undefined,removalHeaders)).status,200);

      const removalUI=await context.newPage();await removalUI.goto(origin+'/#connections');await removalUI.getByRole('button',{name:'Remove connection External tab',exact:true}).click();

      await removalUI.getByRole('button',{name:'Cancel',exact:true}).click();assert.ok((await ok('/studio/overview')).connections.some(c=>c.id===other.id));

      await removalUI.getByRole('button',{name:'Remove connection External tab',exact:true}).click();
      const deleteButton=removalUI.getByRole('button',{name:'Confirm deletion',exact:true});assert.equal(await deleteButton.isEnabled(),false);
      await removalUI.getByLabel('Deletion confirmation').fill('Delete "Another tab"');assert.equal(await deleteButton.isEnabled(),false);assert.ok((await ok('/studio/overview')).connections.some(c=>c.id===other.id));
      await removalUI.getByLabel('Deletion confirmation').fill('Delete "External tab"');await deleteButton.click();

      await removalUI.getByText('Connection and associated actions, keys and run history deleted.',{exact:true}).waitFor();

      const overview=await ok('/studio/overview');assert.equal(overview.connections.some(c=>c.id===other.id),false);assert.equal(overview.workflows.some(w=>w.id===chat.id),false);assert.equal(overview.runs.some(r=>r.workflow_id===chat.id),false);assert.ok(overview.connections.some(c=>c.id===connection.id));

      assert.equal((await call(`/studio/connections/${other.id}/browser-link`)).status,404);assert.equal((await call('/v1/runs/'+pending,undefined,removalHeaders)).status,401);

      assert.equal(await external.title(),'Owned rich chat','removing Hermo data leaves the website tab open');await removalUI.close();

    });

    assert.deepEqual(errors,[]);await ui.close();

   });

   if((await ok('/studio/overview')).connections.some(c=>c.id===other.id))await ok(`/studio/connections/${other.id}/disconnect`,{});await external.close();

  });

  await t.test('wrong tab, credential pages and lock fail closed without cookie/capability export',async()=>{

   await website.goto('http://localhost:'+port+'/sandbox/');assert.equal((await call(`/studio/connections/${connection.id}/browser`)).status,422,'a different origin is never inspected');

   await website.goto(origin+'/');assert.equal((await call(`/studio/connections/${connection.id}/browser`)).status,422,'local private routes cannot be inspected');

   await website.goto(origin+'/sandbox/');assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,false,'returning to the website never restores authority implicitly');
   const freshGrant=await ok(`/studio/connections/${connection.id}/browser-link`,{password,authorized:true});await website.bringToFront();
   const selected=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(x=>x.url===website.url());await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:selected.targetId});await new Promise(r=>setTimeout(r,500));
   const freshPopup=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url.endsWith('/popup.html'));assert.ok(freshPopup);
   await evaluateTarget(freshPopup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(freshGrant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
   for(let n=0;n<50;n++){if((await ok(`/studio/connections/${connection.id}/browser-link`)).linked)break;await new Promise(r=>setTimeout(r,100));}assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,true,'explicit fresh pairing restores selected-tab access');
   await context.clearCookies();await website.reload();const snap=await snapshot();assert.equal(snap.can_confirm,false);assert.equal(snap.elements.length,0,'no password or MFA form is exposed');

   const signedOut=await finish((await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:'ORD-2041'}})).run_id);assert.equal(signedOut.status,'failed');assert.equal(signedOut.result,undefined);

   assert.equal((await ok('/studio/overview')).connections.find(c=>c.id===connection.id).display_status,'connected','a sign-in page does not discard the authorized tab connection');assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,true);

   await website.getByLabel('Email').fill('alex@northstar.example');await website.getByLabel('Password').fill('demo-only-local');await website.getByRole('button',{name:'Sign in',exact:true}).click();await website.waitForURL('**/sandbox/orders');

   const recovered=await finish((await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:'ORD-2041'}})).run_id);assert.equal(recovered.status,'succeeded',JSON.stringify(recovered));assert.equal(recovered.result.status,'Shipped','signing in again restores runs without pairing or profile confirmation');

   const exported=JSON.stringify(await ok('/studio/privacy-export'));for(const secret of [grant.code,key.key,'hb_session_','hermo_demo','storageState'])assert.equal(exported.includes(secret),false,secret);

   assert.equal((await call('/companion/browser/reply',{id:'unrequested',ok:true,value:true},extHeaders)).status,401);

   await ok(`/studio/connections/${connection.id}/disconnect`,{});assert.equal((await ok('/studio/overview')).connections.find(c=>c.id===connection.id).browser_mode,'connected','disconnect never silently changes browser mode');

   await ok('/studio/logout',{});assert.equal((await call('/studio/overview')).status,401);

   await new Promise(r=>setTimeout(r,200));assert.match(await evaluateTarget(controllerTarget,"JSON.stringify(globalThis.hermoConnectionStates)"),/offline|stopped/i);

  });

 }finally{await browser?.close();await app.close();}

});
