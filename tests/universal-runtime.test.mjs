import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {verifierSchema,verifyResult} from '../server/verification.mjs';

test('media URL verification requires portable links and changed verification requires observed evidence',()=>{
  const definition={version:'fixture',outputs:[{name:'asset_url'}],verifiers:[{kind:'url',output:'asset_url'},{kind:'changed',output:'asset_url'}]};
  for(const rule of definition.verifiers)assert.equal(verifierSchema.safeParse(rule).success,true);
  const result={asset_url:'https://assets.example/image.png?width=960&signature=owned-result'};
  assert.throws(()=>verifyResult(definition,result,{},'public_source_origin'),error=>error.verification.reason==='not_fresh');
  assert.ok(verifyResult(definition,result,{},'public_source_origin',{asset_url:{fresh:true}}).checks.includes('asset_url_changed'));
  for(const value of ['data:image/png;base64,QQ==','blob:https://example.com/id','file:///private.png','https://owner:password@example.com/image.png','not a URL'])assert.throws(()=>verifyResult(definition,{asset_url:value},{},'public_source_origin',{asset_url:{fresh:true}}),error=>error.verification.reason==='invalid_url');
});

test('media inspection and commands preserve selected asset URLs, labels and readiness without pixels or credentials',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();
    await page.route('https://example.com/**',route=>route.request().url().includes('/asset.svg')?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="blue"/></svg>'}):route.fulfill({contentType:'text/html',body:'<main><img id="result" src="/asset.svg?width=960&amp;signature=owned" alt="Generated landscape" width="240" height="160"><a id="file" href="https://files.example/report.csv?signature=owned" download="report.csv">Download report</a><img class="avatar" src="/asset.svg" alt="Profile" width="40" height="40"><img id="inline" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22160%22%3E%3C/svg%3E" alt="Local-only canvas result" width="240" height="160"><a id="credential" href="https://owner:secret@files.example/private.csv" download>Unsafe credential URL</a></main>'}));
    await page.goto('https://example.com/');
    const doc=await page.evaluate(inspectDocument,{connected:true}),fields=doc.elements.filter(item=>item.kind==='output'&&item.read_attribute);
    assert.equal(fields.find(item=>item.selector==='#result'&&item.read_attribute==='src').preview,'https://example.com/asset.svg?width=960&signature=owned');
    assert.equal(fields.find(item=>item.selector==='#result'&&item.read_attribute==='alt').preview,'Generated landscape');
    assert.equal(fields.find(item=>item.selector==='#file'&&item.read_attribute==='download').preview,'report.csv');
    assert.ok(fields.every(item=>item.identity_eligible===false&&item.semantic_role==='media'));
    assert.equal(fields.some(item=>item.selector==='#inline'&&item.read_attribute==='src'),false);
    assert.equal(fields.some(item=>/secret|owner:|avatar/.test(item.preview)),false);
    const chrome={tabs:{get:async()=>({url:page.url(),status:'complete'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
    const read=(attribute,details=true)=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'read',selector:'#result',read_attribute:attribute,details},inspect:inspectDocument});
    assert.deepEqual(await read('src'),{text:'https://example.com/asset.svg?width=960&signature=owned',count:1,streaming:false});
    assert.equal(await read('alt',false),'Generated landscape');
    await page.locator('main').evaluate(el=>el.setAttribute('aria-busy','true'));
    assert.equal((await read('src')).streaming,true);
    await assert.rejects(executeBrowserCommand({chrome,tabId:1,origin:'https://wrong.example',command:{op:'read',selector:'#result',read_attribute:'src'},inspect:inspectDocument}),/ORIGIN_CHANGED/);
    await page.locator('main').evaluate(el=>el.insertAdjacentHTML('beforeend','<input type="password" value="synthetic-secret">'));
    await assert.rejects(read('src'),/LOGIN_REQUIRED/);
  }finally{await browser.close();}
});

const fixtureHTML=`<!doctype html><html><head><meta charset="utf-8"><title>Universal tasks fixture</title><style>body{font:16px system-ui;padding:20px}section{border:1px solid #ccc;padding:16px;margin:12px}input,textarea,select,button{padding:8px;margin:5px}img{display:block}output{display:block;min-height:24px}</style></head><body><main>
<section><h2>Conversation</h2><textarea id="chat-input" aria-label="Message"></textarea><button id="chat-send">Send message</button><div id="chat-turns"><div data-message-author-role="user">Initial question</div><div data-message-author-role="assistant">Initial reply</div></div></section>
<section><h2>Media generation</h2><input id="media-prompt" aria-label="Image description"><button id="generate">Generate image</button><img id="generated-image" src="/sandbox/universal-assets/seed.svg" alt="Generated landscape" width="240" height="160"><output id="media-count">0</output></section>
<section><h2>Video generation</h2><input id="video-prompt" aria-label="Video description"><button id="generate-video">Generate video</button><video id="generated-video" src="/sandbox/universal-assets/seed.webm" width="240" height="160"></video></section>
<section><h2>Weather data</h2><output id="place">Colombo</output><output id="temperature">28 \u00b0C</output><output id="humidity">70%</output></section>
<section><h2>Search and extraction</h2><input id="search-query" aria-label="Search query"><button id="search">Search records</button><output id="search-result">Previous search result</output></section>
<section><h2>Form submission</h2><input id="record-name" aria-label="Record name"><button id="save">Save record</button><output id="receipt">Previous record saved</output><output id="save-count">0</output></section>
<section><h2>Custom transformation</h2><select id="format" aria-label="Format"><option value="plain">Plain</option><option value="upper">Uppercase</option></select><input id="include" type="checkbox" aria-label="Include summary"><button id="calculate">Calculate total</button><output id="custom-result">Waiting</output></section>
</main><script src="/sandbox/universal.js"></script></body></html>`;
const fixtureJS=`const get=id=>document.getElementById(id);window.taskCounts={chat:0,media:0,video:0,search:0,save:0,custom:0};
get('chat-send').onclick=()=>{taskCounts.chat++;get('chat-send').disabled=true;const question=get('chat-input').value;const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=question;get('chat-turns').append(user);setTimeout(()=>{const reply=document.createElement('div');reply.dataset.messageAuthorRole='assistant';reply.textContent='Answer: '+question;get('chat-turns').append(reply);get('chat-send').disabled=false;},350);};
get('generate').onclick=()=>{const number=++taskCounts.media;get('media-count').textContent=number;get('generate').disabled=true;get('generated-image').setAttribute('aria-busy','true');setTimeout(()=>{if(get('media-prompt').value==='REORDER_OLD'){get('generated-image').src=get('gallery-existing').src;}else if(get('media-prompt').value!=='KEEP_OLD'){get('generated-image').src='/sandbox/universal-assets/image-'+number+'.svg?width=960&signature=owned-result';}get('generated-image').removeAttribute('aria-busy');get('generate').disabled=false;},1100);};
get('generate-video').onclick=()=>{const number=++taskCounts.video;get('generate-video').disabled=true;get('generated-video').setAttribute('aria-busy','true');setTimeout(()=>{get('generated-video').src='/sandbox/universal-assets/video-'+number+'.webm?signature=owned-video';get('generated-video').removeAttribute('aria-busy');get('generate-video').disabled=false;},700);};
get('search').onclick=()=>{taskCounts.search++;get('search-result').setAttribute('aria-busy','true');const query=get('search-query').value;setTimeout(()=>{get('search-result').textContent=query+' — Found 3 records';get('search-result').removeAttribute('aria-busy');},700);};
get('save').onclick=()=>{const number=++taskCounts.save;get('save-count').textContent=number;get('receipt').setAttribute('aria-busy','true');const name=get('record-name').value;setTimeout(()=>{get('receipt').textContent=name+' saved · receipt '+number;get('receipt').removeAttribute('aria-busy');},700);};
get('calculate').onclick=()=>{taskCounts.custom++;get('custom-result').textContent=get('format').value==='upper'?'TOTAL: 42':'Total: 42';if(get('include').checked)get('custom-result').textContent+=' with summary';};`;

test('private selected-tab tasks with no visible account identity create APIs for chat, media, read, search, submit and custom',{timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4409,{app,origin,store}=await createApp({port,dataDir:resolve('work/universal-runtime-tests',randomBytes(6).toString('hex'))});
  app.get('/sandbox/universal',async(_req,reply)=>reply.type('text/html').send(fixtureHTML));
  app.get('/sandbox/universal-start',async(_req,reply)=>reply.type('text/html').send('<!doctype html><html><head><meta charset="utf-8"><title>Start task</title></head><body><main><p>Ready to open the generator</p></main></body></html>'));
  app.get('/sandbox/universal.js',async(_req,reply)=>reply.type('text/javascript').send(fixtureJS));
  app.get('/sandbox/universal-assets/:file',async(req,reply)=>req.params.file.endsWith('.webm')?reply.type('video/webm').send(readFileSync(new URL('./fixtures/preview.webm',import.meta.url))):reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="purple"/></svg>'));
  await app.listen({port,host:'127.0.0.1'});
  let cookie='',csrf='',context,cdp,connection;
  const password='synthetic-universal-workspace-password';
  const call=async(path,body,extra={})=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...cookie?{cookie}:{},...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...extra},body:body===undefined?undefined:JSON.stringify(body)});const set=response.headers.get('set-cookie');if(set?.startsWith('hermo_owner_'))cookie=set.split(';')[0];return {status:response.status,value:await response.json()};};
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const finish=async(runId,headers)=>{for(let i=0;i<180;i++){const run=await ok((headers?'/v1/runs/':'/studio/runs/')+runId,undefined,headers);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(done=>setTimeout(done,300));}throw Error('Synthetic run did not finish');};
  async function evaluateTarget(targetId,expression){const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});try{return await new Promise((resolve,reject)=>{const listener=event=>{if(event.sessionId!==sessionId)return;const value=JSON.parse(event.message);if(value.id!==1)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(value.error||value.result?.exceptionDetails)reject(Error(JSON.stringify(value)));else resolve(value.result.result.value);};const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Extension evaluation timed out'));},15000);cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);});}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}}
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password})).csrf;
    connection=(await ok('/studio/connections',{name:'Universal website tasks',url:origin+'/sandbox/universal',access:'account',browser_mode:'connected',authorized:true})).connection;
    context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
    cdp=await context.browser().newBrowserCDPSession();const {id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});
    const website=await context.newPage();await website.goto(origin+'/sandbox/universal');await website.waitForFunction(()=>typeof window.taskCounts==='object');
    await context.addCookies([{name:cookie.slice(0,cookie.indexOf('=')),value:cookie.slice(cookie.indexOf('=')+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
    const connectionUI=await context.newPage();connectionUI.setDefaultTimeout(10000);await connectionUI.goto(origin+'/#connections');
    const connectionCard=connectionUI.locator('.connection-card').filter({has:connectionUI.getByRole('heading',{name:'Universal website tasks',exact:true})});
    await connectionCard.getByRole('button',{name:'Connect tab',exact:true}).click();
    assert.equal(await connectionUI.getByRole('button',{name:'Account marker',exact:true}).count(),0);
    assert.equal(await connectionUI.getByRole('button',{name:'Confirm this account',exact:true}).count(),0);
    await connectionUI.getByRole('checkbox',{name:/I authorize Hermo to read this website tab/}).check();
    await connectionUI.getByRole('button',{name:'Create Connect code',exact:true}).click();
    await connectionUI.locator('.normal-chrome-grant input').waitFor();
    const grant={code:await connectionUI.locator('.normal-chrome-grant input').inputValue()};
    const previewPath=`**/studio/connections/${connection.id}/browser`;
    await connectionUI.route(previewPath,route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'BROWSER_TAB_UNAVAILABLE',message:'Synthetic completion preview failure.'}})}));
    const target=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(item=>item.url===website.url());assert.ok(target);
    await website.bringToFront();
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});
    let popup;for(let i=0;i<25;i++){popup=(await cdp.send('Target.getTargets')).targetInfos.find(item=>item.url.endsWith('/popup.html'));if(popup)break;await new Promise(done=>setTimeout(done,100));}assert.ok(popup);
    // Chrome creates the popup target before asynchronous extension module
    // initialization has registered the form handler.
    await new Promise(done=>setTimeout(done,750));
    await evaluateTarget(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
    for(let i=0;i<60;i++){if((await ok(`/studio/connections/${connection.id}/browser-link`)).linked)break;await new Promise(done=>setTimeout(done,100));}
    const linked=(await ok(`/studio/connections/${connection.id}/browser-link`)).linked;
    let pairDiagnostics='';if(!linked)try{pairDiagnostics=await evaluateTarget(popup.targetId,'document.body.innerText');}catch{pairDiagnostics='The extension popup closed before pairing completed.';}
    assert.equal(linked,true,pairDiagnostics);
    await cdp.send('Target.closeTarget',{targetId:popup.targetId});
    await connectionUI.getByText('Synthetic completion preview failure.',{exact:true}).first().waitFor();
    await connectionUI.unroute(previewPath);
    await connectionUI.getByRole('dialog').waitFor({state:'hidden'});
    await connectionCard.getByText('Connected',{exact:true}).waitFor();await connectionUI.close();
    const paired=(await ok('/studio/overview')).connections.find(value=>value.id===connection.id);
    assert.equal(paired.status,'connected');assert.equal(paired.display_status,'connected');
    assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).confirmed,true);
    const binding=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id).payload).identity;
    assert.deepEqual(binding,{kind:'selected_tab',origin});
    await ok(`/studio/connections/${connection.id}/open`,{});
    const ready=await ok(`/studio/connections/${connection.id}/browser`);
    assert.equal(ready.elements.some(item=>item.identity_eligible===true),false,'private tasks have no visible profile identity and require no confirm call');
    await website.reload();await website.waitForFunction(()=>typeof window.taskCounts==='object');
    assert.equal((await ok('/studio/overview')).connections.find(value=>value.id===connection.id).display_status,'connected','website reload retains active tab authority');
    const snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);
    const action=async({name,type,slug,steps=[],outputs,rules,input={}})=>{
      const recording=await ok('/studio/recordings',{connection_id:connection.id,name,slug,action_type:type});
      for(const step of steps){const snap=await snapshot(),item=snap.elements.find(value=>value.label===step.label&&value.kind===step.kind);assert.ok(item,step.label);await ok(`/studio/connections/${connection.id}/control`,{element_id:item.id,kind:step.operation??(step.kind==='input'?'fill':step.kind==='select'?'select':step.kind==='check'?'check':'click'),...step.value!==undefined?{value:step.value}:{},recording_id:recording.id,...step.parameter?{parameter:step.parameter}:{}});}
      await new Promise(done=>setTimeout(done,1300));
      let snap=await snapshot();
      for(const output of outputs){const item=snap.elements.find(output.select);assert.ok(item,output.name+' '+JSON.stringify(snap.elements));await ok(`/studio/recordings/${recording.id}/output`,{element_id:item.id,name:output.name});}
      const workflow=(await ok(`/studio/recordings/${recording.id}/finish`,{verifiers:rules,...type==='generate_media'?{timeout_seconds:15}:{}})).workflow;
      const ownerRun=await finish((await ok(`/studio/workflows/${workflow.id}/test`,{input})).run_id);assert.equal(ownerRun.status,'succeeded',JSON.stringify(ownerRun));
      await ok(`/studio/workflows/${workflow.id}/publish`,{});const key=await ok('/studio/keys',{workflow_id:workflow.id,name:name+' key'});return {workflow,key,ownerRun};
    };
    const media=await action({name:'Generate image',type:'generate_media',slug:'universal.media',steps:[{label:'Image description',kind:'input',value:'Landscape',parameter:'description'},{label:'Generate image',kind:'button'}],outputs:[{name:'image_url',select:item=>item.type==='image_url'}],rules:[{kind:'url',output:'image_url'},{kind:'changed',output:'image_url'}],input:{description:'Landscape API'}});
    assert.ok(media.ownerRun.result.image_url.includes('signature=owned-result'));assert.ok(media.ownerRun.verification.checks.includes('fresh_generated_outputs'));
    const beforeAPI=await website.evaluate(()=>taskCounts.media),headers={Authorization:'Bearer '+media.key.key,'Idempotency-Key':'media-api-repeat'};
    const accepted=await ok('/v1/actions/universal.media/versions/1/runs',{input:{description:'API image'}},headers);assert.equal((await ok('/v1/actions/universal.media/versions/1/runs',{input:{description:'API image'}},headers)).run_id,accepted.run_id);
    const apiRun=await finish(accepted.run_id,headers);assert.equal(apiRun.status,'succeeded',JSON.stringify(apiRun));assert.equal(await website.evaluate(()=>taskCounts.media),beforeAPI+1,'idempotent admission does not generate twice');
    const mcpHeaders={Authorization:'Bearer '+media.key.key,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'};
    await ok('/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'universal-media-test',version:'1'}}},mcpHeaders);
    const tools=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},mcpHeaders);assert.ok(tools.result.tools.some(item=>item.name==='action_universal_media'));
    const invoked=await ok('/mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'action_universal_media',arguments:{input:{description:'MCP image'},request_id:'media-mcp'}}},mcpHeaders);assert.equal(invoked.result.isError,undefined,JSON.stringify(invoked));assert.equal((await finish(invoked.result.structuredContent.run_id,mcpHeaders)).status,'succeeded');
    await t.test('recorded video generation returns a fresh typed URL through scoped REST and MCP',async()=>{
      const video=await action({name:'Generate video',type:'generate_media',slug:'universal.video',steps:[{label:'Video description',kind:'input',value:'Short clip',parameter:'description'},{label:'Generate video',kind:'button'}],outputs:[{name:'video_url',select:item=>item.type==='video_url'}],rules:[{kind:'url',output:'video_url'},{kind:'changed',output:'video_url'}],input:{description:'Verified clip'}});
      const headers={Authorization:'Bearer '+video.key.key,'Idempotency-Key':'video-api'};
      const receipt=await ok('/v1/actions/universal.video/versions/1/runs',{input:{description:'API clip'}},headers),run=await finish(receipt.run_id,headers);
      assert.equal(run.status,'succeeded',JSON.stringify(run));assert.match(run.result.video_url,/signature=owned-video/);assert.ok(run.verification.checks.includes('fresh_generated_outputs'));
      const contract=await ok('/v1/action-contract',undefined,headers);assert.equal(contract.outputs[0].media_type,'video');assert.equal(contract.output_schema.properties.video_url['x-hermo-media-type'],'video');
      const mcp=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'action_universal_video',arguments:{input:{description:'MCP clip'},request_id:'video-mcp'}}},{Authorization:'Bearer '+video.key.key,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'});
      assert.equal((await finish(mcp.result.structuredContent.run_id,headers)).status,'succeeded');
    });
    const tasks=[
      {name:'Conversation reply',type:'chat',slug:'universal.chat',steps:[{label:'Message',kind:'input',value:'Hello',parameter:'prompt'},{label:'Send message',kind:'button'}],outputs:[{name:'prompt_echo',select:item=>item.semantic_role==='user'},{name:'response',select:item=>item.semantic_role==='assistant'}],rules:[{kind:'equals_input',output:'prompt_echo',input:'prompt'},{kind:'changed',output:'response'}],input:{prompt:'Hello API'},apiInput:{prompt:'Hello REST'}},
      {name:'Read weather',type:'read',slug:'universal.weather',outputs:[{name:'temperature',select:item=>item.preview==='28 \u00b0C'},{name:'location',select:item=>item.preview==='Colombo'}],rules:[{kind:'number',output:'temperature',unit:'\u00b0C'},{kind:'contains',output:'location',value:'Colombo'}],apiInput:{}},
      {name:'Search records',type:'search_extract',slug:'universal.search',steps:[{label:'Search query',kind:'input',value:'Invoices',parameter:'query'},{label:'Search records',kind:'button'}],outputs:[{name:'records',select:item=>item.preview?.includes('Found 3 records')}],rules:[{kind:'changed',output:'records'},{kind:'contains',output:'records',value:'Found 3 records'}],input:{query:'Receipts'},apiInput:{query:'Projects'}},
      {name:'Submit record',type:'submit_form',slug:'universal.submit',steps:[{label:'Record name',kind:'input',value:'Recorded draft',parameter:'record_name'},{label:'Save record',kind:'button'}],outputs:[{name:'receipt',select:item=>item.preview?.includes('saved \u00b7 receipt')}],rules:[{kind:'changed',output:'receipt'},{kind:'contains',output:'receipt',value:'saved'}],input:{record_name:'API draft'},apiInput:{record_name:'REST draft'}},
      {name:'Custom transformation',type:'custom',slug:'universal.custom',steps:[{label:'Format',kind:'select',value:'upper',parameter:'format'},{label:'Include summary',kind:'check',value:'true'},{label:'Calculate total',kind:'button'}],outputs:[{name:'summary',select:item=>item.preview==='TOTAL: 42 with summary'}],rules:[{kind:'changed',output:'summary'},{kind:'contains',output:'summary',value:'42'}],input:{format:'plain'},apiInput:{format:'upper'}}
    ];
    for(const task of tasks)await t.test(task.name+' records, verifies, publishes and runs over REST',async()=>{
      const result=await action(task),apiHeaders={Authorization:'Bearer '+result.key.key,'Idempotency-Key':task.slug+'-rest'};
      const receipt=await ok('/v1/actions/'+task.slug+'/versions/1/runs',{input:task.apiInput},apiHeaders),run=await finish(receipt.run_id,apiHeaders);assert.equal(run.status,'succeeded',JSON.stringify(run));
      assert.ok(run.verification.checks.includes('selected_tab_origin'));
      const contract=await ok('/v1/action-contract',undefined,apiHeaders);assert.equal(contract.action,task.slug);assert.deepEqual(contract.outputs.map(output=>output.name),task.outputs.map(output=>output.name));
      assert.equal((await call('/v1/runs/'+receipt.run_id,undefined,{Authorization:'Bearer '+media.key.key})).status,404,'different action consumer cannot read these outputs');
    });
    await t.test('generic consumer app runs generation and displays verified asset links',async()=>{
      const consumer=await context.newPage();await consumer.goto(origin+'/workflow-data.html?action=universal.media');
      await consumer.getByLabel('Hermo API key').fill(media.key.key);await consumer.getByRole('button',{name:'Use this action',exact:true}).click();
      await consumer.getByLabel('description',{exact:true}).fill('Consumer image');await consumer.getByRole('button',{name:'Run action',exact:true}).click();
      await consumer.getByText('Verified results received',{exact:false}).waitFor();const link=consumer.getByRole('link',{name:'Open image_url'});await link.waitFor();
      assert.match(await link.getAttribute('href'),/signature=owned-result/);assert.equal(await consumer.getByLabel('Hermo API key').inputValue(),'');await consumer.close();
    });
    await t.test('a new pairing code does not complete against a previously connected tab',async()=>{
      const ui=await context.newPage();ui.setDefaultTimeout(10000);await ui.goto(origin+'/#connections');
      const card=ui.locator('.connection-card').filter({has:ui.getByRole('heading',{name:'Universal website tasks',exact:true})});
      await card.getByRole('button',{name:'Open browser',exact:true}).click();
      await ui.getByRole('button',{name:'Detected fields',exact:true}).click();await ui.locator('.browser-dom-preview').waitFor();
      await ui.locator('.connected-tab-setup > summary').click();
      await ui.getByRole('checkbox',{name:/I authorize Hermo to read this website tab/}).check();
      await ui.getByRole('button',{name:'Create Connect code',exact:true}).click();
      await ui.locator('.normal-chrome-grant input').waitFor();
      const state=await ok(`/studio/connections/${connection.id}/browser-link`);
      assert.equal(state.linked,true);assert.equal(state.confirmed,true);assert.equal(state.pairing_pending,true);
      await new Promise(done=>setTimeout(done,2000));
      assert.equal(await ui.getByRole('dialog').isVisible(),true,'existing authority cannot consume the fresh pairing flow');
      assert.match(await ui.locator('.normal-chrome-grant input').inputValue(),/^hb_pair_/);
      await ui.getByRole('button',{name:'Check tab connection',exact:true}).click();
      await ui.getByText('Paste this Connect code into the website companion first.',{exact:true}).waitFor();
      assert.equal(await ui.getByRole('dialog').isVisible(),true,'manual check also waits for the new pairing code');
      await ui.getByRole('button',{name:'Close dialog',exact:true}).click();await ui.close();
    });
    await t.test('existing gallery assets are not accepted as newly generated results',async()=>{
      await website.evaluate(()=>{const existing=document.createElement('img');existing.id='gallery-existing';existing.src=location.origin+'/sandbox/universal-assets/gallery-before.svg';existing.alt='Previous gallery result';existing.width=240;existing.height=160;document.querySelector('#generated-image').after(existing);});
      await website.locator('#gallery-existing').waitFor();await website.waitForFunction(()=>document.getElementById('gallery-existing').complete);
      const before=await website.evaluate(()=>taskCounts.media),receipt=await ok(`/studio/workflows/${media.workflow.id}/test`,{input:{description:'REORDER_OLD'}}),run=await finish(receipt.run_id);
      assert.equal(run.status,'failed');assert.equal(run.error.verification.reason,'not_fresh');assert.equal(run.result,undefined);assert.equal(await website.evaluate(()=>taskCounts.media),before+1);
    });
    await t.test('navigation captures the destination media baseline before generation',async()=>{
      const row=store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(media.workflow.id),definition=store.unseal(row.payload);
      const altered=structuredClone(definition);altered.steps.unshift({op:'navigate',url:origin+'/sandbox/universal'});
      store.db.prepare('UPDATE workflows SET payload=? WHERE id=?').run(store.seal(altered),media.workflow.id);
      try{await website.goto(origin+'/sandbox/universal-start');const receipt=await ok(`/studio/workflows/${media.workflow.id}/test`,{input:{description:'KEEP_OLD'}}),run=await finish(receipt.run_id);assert.equal(run.status,'failed');assert.equal(run.error.verification.reason,'not_fresh');assert.equal(run.result,undefined);assert.equal(await website.evaluate(()=>taskCounts.media),1);}finally{store.db.prepare('UPDATE workflows SET payload=? WHERE id=?').run(row.payload,media.workflow.id);}
    });
    // A stale asset fails with no stale result and no repeated website action.
    const beforeStale=await website.evaluate(()=>taskCounts.media),stale=await ok(`/studio/workflows/${media.workflow.id}/test`,{input:{description:'KEEP_OLD'}});
    const staleRun=await finish(stale.run_id);assert.equal(staleRun.status,'failed');assert.equal(staleRun.error.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(staleRun.error.cause_code,'VERIFICATION_FAILED');assert.equal(staleRun.error.retry_safe,false);assert.equal(staleRun.error.verification.reason,'not_fresh');assert.equal(staleRun.result,undefined);assert.equal(await website.evaluate(()=>taskCounts.media),beforeStale+1);
    await t.test('sign-in blocks replay and recording without dropping the paired tab, then recovers without confirmation',async()=>{
      const weather=store.db.prepare("SELECT id FROM workflows WHERE slug='universal.weather'").get();assert.ok(weather);
      await website.evaluate(()=>{const password=document.createElement('input');password.type='password';password.id='synthetic-sign-in';document.querySelector('main').prepend(password);});
      const blockedRecording=await call('/studio/recordings',{connection_id:connection.id,name:'Blocked sign in',slug:'blocked.signin',action_type:'read'});
      assert.equal(blockedRecording.status,409);assert.equal(blockedRecording.value.error.code,'CONNECTION_NOT_READY');
      const failed=await finish((await ok(`/studio/workflows/${weather.id}/test`,{input:{}})).run_id);
      assert.equal(failed.status,'failed');assert.equal(failed.error.code,'AUTH_REQUIRED');assert.match(failed.error.message,/website needs sign-in or verification/);assert.equal(failed.result,undefined);
      const stillLinked=(await ok('/studio/overview')).connections.find(value=>value.id===connection.id);
      assert.equal(stillLinked.status,'connected');assert.equal(stillLinked.display_status,'connected');assert.equal(stillLinked.browser_linked,true);
      await website.locator('#synthetic-sign-in').evaluate(el=>el.remove());
      const recovered=await finish((await ok(`/studio/workflows/${weather.id}/test`,{input:{}})).run_id);
      assert.equal(recovered.status,'succeeded',JSON.stringify(recovered));assert.equal(recovered.result.location,'Colombo');assert.ok(recovered.verification.checks.includes('selected_tab_origin'));
    });
    await t.test('generation records the media attribute in its stable REST contract',async()=>{const exported=await ok(`/studio/workflows/${media.workflow.id}/export`);assert.equal(exported.outputs[0].read_attribute,'src');assert.equal(JSON.stringify(exported).includes('synthetic-universal-workspace-password'),false);});
  }finally{await context?.close().catch(()=>{});await app.close();}
});
