// Three executable acceptance demos against a disposable runtime and the actual
// production Chrome companion. No database fixtures or external accounts.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../server/index.mjs';
import {createConsumerHost} from '../validation-apps/shared/host.mjs';
import {createCompanionSession} from './lib/companion-session.mjs';

const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const terminal=run=>['succeeded','failed','cancelled'].includes(run?.status);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const unpack=value=>value.structuredContent??JSON.parse(value.content.find(item=>item.type==='text').text);
const safeError=error=>String(error.message??error).replace(/(?:hm_live_|hb_session_|hb_pair_)[A-Za-z0-9_-]+/g,'<redacted>');
async function until(read,predicate,label,timeout=60000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await read();if(predicate(value))return value;await sleep(100);}
  throw Error('Timed out: '+label);
}
async function freePort(){const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));const port=server.address().port;await new Promise(done=>server.close(done));return port;}

export async function runTrustedDemos({browserPath,outputDir=resolve('validation/results'),dataDir=resolve('work/trusted-execution',randomUUID()),onProgress=()=>{}}={}){
  const previousMaster=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const report={kind:'trusted-execution-demos',started_at:new Date().toISOString(),runtime:'disposable loopback workspace',browser_mode:'connected_chrome',provisioning:'owner HTTP recording/editor/test/publish; no database seeding',demos:[],runs:[]};
  const allRuns=new Map(),hosts=[],clients=[];let runtime,browser,cookie='',csrf='',stage='start disposable runtime',posts=0;
  const record=run=>{assert.ok(run?.id);allRuns.set(run.id,run);return run;};
  const fixtureHTML=(message='',receipt='No request yet')=>`<!doctype html><html lang="en"><title>Trusted execution fixture</title><main><h1>Stationery inventory</h1><p id="summary">Authorized stationery catalog</p><table id="catalog"><thead><tr><th>SKU</th><th>Category</th><th>Price</th><th>Quantity</th></tr></thead><tbody><tr><td class="sku">PEN-01</td><td class="category">stationery</td><td class="price">4.5</td><td class="quantity">12</td></tr><tr><td class="sku">BOOK-02</td><td class="category">stationery</td><td class="price">7</td><td class="quantity">5</td></tr></tbody></table><h2>Create a task</h2><form method="post" action="/sandbox/trusted/submit"><label for="task">Task message</label><input id="task" name="task" required><button id="submit" type="submit">Submit task</button></form><p>Latest receipt: <output id="receipt">${escape(receipt)}</output></p><p>Confirmed task: <output id="result">${escape(message||'No task submitted')}</output></p></main></html>`;
  try{
    const port=await freePort();runtime=await createApp({port,dataDir});const {app,origin}=runtime;
    app.get('/sandbox/trusted/',async(_,reply)=>reply.type('text/html').send(fixtureHTML()));
    app.post('/sandbox/trusted/submit',async(req,reply)=>{const body=new URLSearchParams(req.body);posts++;return reply.type('text/html').send(fixtureHTML(body.get('task'),`receipt-${posts}`));});
    await app.listen({port,host:'127.0.0.1'});
    const request=async(path,body,{key,headers={},allowFailure=false}={})=>{
      const owner=path.startsWith('/studio/');
      const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...owner?{cookie,'x-hermo-csrf':csrf}:{},...key?{authorization:'Bearer '+key}:{},...body===undefined?{}:{'content-type':'application/json'},...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
      if(owner&&response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      const value=await response.json();if(!allowFailure)assert.ok(response.ok,`${path}: HTTP ${response.status}, ${value.error?.code??'request rejected'}`);return {status:response.status,value};
    };
    // This fixture owner explicitly reviews and authorizes configured publication changes.
    const owner=async(path,body)=>{if(body!==undefined&&/^\/studio\/workflows\/[^/]+\/publish$/.test(path)){const review=await owner(path.replace(/\/publish$/,'/permissions'));body={expected_version:review.version,permission_fingerprint:review.fingerprint,...(review.changes?.breaking?{change_fingerprint:review.changes.fingerprint,accept_breaking:true}:{}),...body};}return (await request(path,body)).value;};
    const read=async(id,key)=>record((await request((key?'/v1':'/studio')+'/runs/'+id,undefined,{key})).value);
    const wait=(receipt,key)=>until(()=>read(receipt.run_id,key),terminal,'terminal execution');
    const waiting=id=>until(()=>read(id),run=>run.phase==='awaiting_approval','owner approval checkpoint');
    const decide=(run,decision)=>owner(`/studio/runs/${run.id}/approval`,{approval_id:run.approval.id,decision});
    const admit=async(workflow,key,input={},requestId=randomUUID())=>(await request(`/v1/actions/${workflow.slug}/versions/1/runs`,{input},{key,headers:{'idempotency-key':requestId}})).value;
    csrf=(await owner('/studio/session')).csrf;csrf=(await owner('/studio/setup',{password:randomBytes(24).toString('hex')})).csrf;
    const connection=(await owner('/studio/connections',{name:'Trusted controlled website',url:origin+'/sandbox/trusted/',access:'public',browser_mode:'connected',authorized:true})).connection;
    stage='pair actual Chrome companion';onProgress(stage);
    browser=await createCompanionSession({origin,owner,connection,url:origin+'/sandbox/trusted/',browserPath});report.browser_version=browser.browserVersion;
    await owner(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    const snapshot=()=>owner(`/studio/connections/${connection.id}/browser`);
    const output=async(recording,name,preview)=>{const selected=(await snapshot()).elements.find(item=>item.kind==='output'&&item.preview===preview);assert.ok(selected,'Detected website output '+name);await owner(`/studio/recordings/${recording.id}/output`,{element_id:selected.id,name});};
    const edit=async(workflow,changes)=>{const editor=await owner(`/studio/workflows/${workflow.id}/editor`);return owner(`/studio/workflows/${workflow.id}/editor`,{expected_version:editor.version,steps:editor.definition.steps,inputs:editor.definition.inputs,outputs:editor.definition.outputs,verifiers:editor.definition.verifiers,timeout_seconds:30,...changes});};
    const publish=workflow=>owner(`/studio/workflows/${workflow.id}/publish`,{});
    const consumer=async(appName,workflow,key,input)=>{
      const host=createConsumerHost({app:appName,runtime:origin,port:0});hosts.push(host);const address=await host.listen(),page=await browser.context.newPage(),responses=new Set(),receipts=[],executions=new Map(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('response',response=>{if(!response.url().endsWith('/api/request'))return;const pending=(async()=>{const value=await response.json().catch(()=>null);for(const candidate of [value,value?.result?.structuredContent]){if(candidate?.run_id&&!candidate.id)receipts.push(candidate);if(candidate?.id&&terminal(candidate)){record(candidate);executions.set(candidate.id,candidate);}}})();responses.add(pending);pending.finally(()=>responses.delete(pending));});
      await page.goto(address);await page.locator('#api-key').fill(key);await page.locator('#endpoint').fill(`/v1/actions/${workflow.slug}/versions/1/runs`);await page.locator('#inputs').fill(JSON.stringify(input));await page.locator('#load-contract').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Published contract loaded'));
      return {page,executions,async run(onPending){const previous=receipts.length,previousExecutions=executions.size;await page.locator('#run').click();if(onPending){const receipt=await until(async()=>receipts[previous],Boolean,'consumer run receipt');await onPending(await waiting(receipt.run_id));}await page.waitForFunction(()=>!document.querySelector('#run').disabled,{},{timeout:90000});await Promise.all([...responses]);assert.equal(errors.length,0,'Consumer UI page errors');assert.ok(executions.size>previousExecutions,'Consumer observed a new actual terminal run');return [...executions.values()].at(-1);}};
    };

    stage='demo 1: structured table and semantic/numeric rejection';onProgress(stage);
    const recording=await owner('/studio/recordings',{connection_id:connection.id,name:'Verified stationery inventory',slug:'demo.inventory',action_type:'read_data'});
    await output(recording,'summary','Authorized stationery catalog');
    const inventory=(await owner(`/studio/recordings/${recording.id}/finish`,{verifiers:[{kind:'nonempty',output:'summary'}],timeout_seconds:30})).workflow;
    const products={name:'products',type:'array',selector:'#catalog tbody tr',minItems:2,maxItems:10,items:{type:'object',fields:[{name:'sku',type:'string',selector:'.sku',minLength:3,maxLength:20},{name:'category',type:'string',selector:'.category'},{name:'price',type:'number',selector:'.price',minimum:0,maximum:1000},{name:'quantity',type:'integer',selector:'.quantity',minimum:1,maximum:100}]}};
    await edit(inventory,{outputs:[products],verifiers:[{kind:'unique',output:'products',path:['sku']},{kind:'rows',output:'products',path:['category'],operator:'eq',value:'stationery',quantifier:'all'}]});
    const inventoryTest=await wait(await owner(`/studio/workflows/${inventory.id}/test`,{input:{}}));assert.equal(inventoryTest.status,'succeeded','Structured owner test');const inventoryKey=await publish(inventory);
    const explorer=await consumer('json-explorer',inventory,inventoryKey.key,{}),explored=await explorer.run();assert.equal(explored.status,'succeeded');assert.equal(await explorer.page.locator('#records tbody tr').count(),2);assert.equal(explored.result.products[0].price,4.5);assert.equal(explored.result.products[0].quantity,12);
    await browser.site.locator('#catalog .category').evaluateAll(nodes=>nodes.forEach(node=>{node.textContent='unrelated';}));
    const unrelated=await explorer.run();assert.equal(unrelated.status,'failed');assert.equal(unrelated.error.verification.reason,'row_mismatch');assert.equal(unrelated.result,undefined);
    await browser.site.locator('#catalog .category').evaluateAll(nodes=>nodes.forEach(node=>{node.textContent='stationery';}));await browser.site.locator('#catalog .quantity').first().evaluate(node=>{node.textContent='-1';});
    const numeric=await explorer.run();assert.equal(numeric.status,'failed');assert.equal(numeric.error.verification.reason,'below_minimum');assert.deepEqual(numeric.error.verification.path,['products',0,'quantity']);assert.equal(numeric.result,undefined);
    await browser.site.locator('#catalog .quantity').first().evaluate(node=>{node.textContent='12';});
    report.demos.push({name:'structured-table',application:'json-explorer',status:'passed',verified_run:explored.id,record_count:explored.result.products.length,rejected_runs:[unrelated.id,numeric.id],checks:['numeric bounds','integer schema','unique SKU','all rows match expected category','unrelated table rejected','invalid numeric quantity rejected']});

    stage='demo 2: actual form POST with owner approval and rejection';onProgress(stage);
    await browser.site.goto(origin+'/sandbox/trusted/');
    const formRecording=await owner('/studio/recordings',{connection_id:connection.id,name:'Approved task submission',slug:'demo.approval',action_type:'submit_form'});
    const control=async(kind,label,extra={})=>{const item=(await snapshot()).elements.find(item=>item.label===label&&item.kind===(kind==='fill'?'input':'button'));assert.ok(item,'Detected website control '+label);await owner(`/studio/connections/${connection.id}/control`,{element_id:item.id,kind,recording_id:formRecording.id,...extra});};
    await control('fill','Task message',{value:'recorded task',parameter:'task'});await control('click','Submit task');
    await output(formRecording,'result','recorded task');await output(formRecording,'receipt',`receipt-${posts}`);
    const form=(await owner(`/studio/recordings/${formRecording.id}/finish`,{verifiers:[{output:'result',input:'task'},{kind:'changed',output:'receipt'}],timeout_seconds:30})).workflow;
    const formEditor=await owner(`/studio/workflows/${form.id}/editor`);await edit(form,{steps:formEditor.definition.steps.map(step=>step.op==='click'?{...step,approval_required:true,locators:[{kind:'role',role:'button',name:'Submit task'}]}:step),verifiers:[{output:'result',input:'task'},{kind:'changed',output:'receipt'},{kind:'completion',output:'result',evidence:'receipt'}]});
    const formTest=await owner(`/studio/workflows/${form.id}/test`,{input:{task:'owner test task'}}),testApproval=await waiting(formTest.run_id),beforeTest=posts;await decide(testApproval,'approve');const testedForm=await wait(formTest);assert.equal(testedForm.status,'succeeded');assert.equal(posts,beforeTest+1);
    const formKey=await publish(form),consoleApp=await consumer('approval-console',form,formKey.key,{task:'approved consumer task'});
    let observedPendingPosts;
    const beforeApprove=posts,approved=await consoleApp.run(async pending=>{observedPendingPosts=posts-beforeApprove;assert.equal(observedPendingPosts,0,'Pending approval cannot POST');await consoleApp.page.locator('#approval-state[data-state="pending"]').waitFor();await decide(pending,'approve');});assert.equal(approved.status,'succeeded');assert.equal(posts,beforeApprove+1);assert.equal(approved.result.result,'approved consumer task');assert.equal(approved.approval.actor,'workspace_owner');
    const beforeReject=posts,rejected=await consoleApp.run(async pending=>{assert.equal(posts,beforeReject);await decide(pending,'reject');});assert.equal(rejected.status,'failed');assert.equal(rejected.error.cause_code,'APPROVAL_REJECTED');assert.equal(rejected.result,undefined);await sleep(300);assert.equal(posts,beforeReject,'Rejected approval never emits a form POST');
    const deniedApproval=await request(`/studio/runs/${rejected.id}/approval`,{approval_id:rejected.approval.id,decision:'approve'},{key:formKey.key,headers:{cookie:'','x-hermo-csrf':''},allowFailure:true});assert.equal(deniedApproval.status,401);
    report.demos.push({name:'approved-form',application:'approval-console',status:'passed',test_run:testedForm.id,approved_run:approved.id,rejected_run:rejected.id,observed_form_posts:posts,posts_while_pending:observedPendingPosts,posts_after_rejection:posts-beforeReject,checks:['actual HTML form POST','owner approval required','receipt freshness','explicit completion evidence','owner rejection blocks POST','consumer key cannot approve']});

    stage='demo 3: SDK MCP tools, polling, and the same key boundary';onProgress(stage);
    const mcpApp=await consumer('mcp-tools',inventory,inventoryKey.key,{});await mcpApp.page.locator('#discover-tools').click();await mcpApp.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('authorized tools discovered'));const uiMcp=await mcpApp.run();assert.equal(uiMcp.status,'succeeded');
    const connect=async key=>{const client=new Client({name:'hermo-trusted-execution',version:'1.0.0'},{capabilities:{}});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+key}}}));return client;};
    const sdk=await connect(inventoryKey.key),tools=await sdk.listTools(),tool=tools.tools.find(tool=>tool.name==='action_demo_inventory');assert.ok(tool);assert.equal(tools.tools.some(tool=>tool.name==='action_demo_approval'),false);
    const sdkContract=unpack(await sdk.callTool({name:'get_contract',arguments:{}})),restContract=(await request('/v1/action-contract',undefined,{key:inventoryKey.key})).value;assert.deepEqual(sdkContract.output_schema,restContract.output_schema);
    const sdkReceipt=unpack(await sdk.callTool({name:tool.name,arguments:{input:{},request_id:randomUUID()}}));const sdkRun=await until(async()=>record(unpack(await sdk.callTool({name:'get_run',arguments:{run_id:sdkReceipt.run_id}}))),terminal,'SDK get_run terminal');assert.equal(sdkRun.status,'succeeded');assert.deepEqual(sdkRun.result,explored.result);
    const wrongSdk=await connect(formKey.key),crossRead=await wrongSdk.callTool({name:'get_run',arguments:{run_id:sdkRun.id}});assert.equal(crossRead.isError,true);
    const crossRest=await request('/v1/runs/'+sdkRun.id,undefined,{key:formKey.key,allowFailure:true});assert.equal(crossRest.status,404);
    const crossAction=await request(`/v1/actions/${form.slug}/versions/1/runs`,{input:{task:'forbidden'}},{key:inventoryKey.key,headers:{'idempotency-key':randomUUID()},allowFailure:true});assert.equal(crossAction.status,403);
    report.demos.push({name:'mcp-tool-consumer',application:'mcp-tools',status:'passed',ui_run:uiMcp.id,sdk_run:sdkRun.id,sdk:'@modelcontextprotocol/sdk Client + StreamableHTTPClientTransport',discovered_tool_count:tools.tools.length,checks:['actual UI tool discovery and invocation','SDK tool invocation','SDK get_run polling','REST/MCP output schema parity','same key owns run','other key cannot read run or invoke action']});
    const overview=await owner('/studio/overview');report.runtime_counts={observed_runs:overview.runs.length,by_status:Object.fromEntries(['queued','running','verifying','succeeded','failed','cancelled'].map(status=>[status,overview.runs.filter(run=>run.status===status).length])),actual_form_posts:posts};
    assert.equal(overview.runs.length,allRuns.size,'Report includes every accepted actual run');assert.ok([...allRuns.values()].every(terminal),'Every accepted demo run reached a terminal state');report.status='passed';
  }catch(error){report.status='failed';report.failure={stage,message:safeError(error)};throw Object.assign(Error(stage+': '+safeError(error)),{report});}
  finally{
    for(const client of clients)await client.close().catch(()=>{});
    await browser?.close();for(const host of hosts)await new Promise(done=>host.server.close(done));await runtime?.app.close();
    if(previousMaster===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMaster;
    report.completed_at=new Date().toISOString();report.runs=[...allRuns.values()].map(run=>({id:run.id,workflow_id:run.workflow_id,status:run.status,workflow_version:run.workflow_version,workflow_revision:run.workflow_revision,execution_mode:run.execution_mode,queue_duration_ms:run.queue_duration_ms,execution_ms:run.execution_ms,verification:run.verification,error:run.error,approval:run.approval,approval_history:run.approval_history}));
    if(outputDir){await mkdir(outputDir,{recursive:true});const filename='trusted-execution-'+report.started_at.replace(/[:.]/g,'-')+'.json';report.report_path=resolve(outputDir,filename);await writeFile(report.report_path,JSON.stringify(report,null,2)+'\n');}
  }
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const report=await runTrustedDemos({onProgress:message=>console.log(message)});console.log(JSON.stringify({status:report.status,browser_version:report.browser_version,demos:report.demos.map(({name,status})=>({name,status})),runtime_counts:report.runtime_counts,report_path:report.report_path},null,2));}catch(error){console.error(safeError(error));process.exitCode=1;}
}
