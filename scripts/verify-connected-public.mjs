// Live external acceptance: real Chrome companion, owner HTTP provisioning,
// scoped REST/MCP consumers. Uses only the operator's public scraping sandbox.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));
const port=probe.address().port;await new Promise(done=>probe.close(done));
const previousMaster=process.env.HERMO_MASTER_KEY;
process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
const {app,origin}=await createApp({port,dataDir:resolve('work/connected-public',stamp)});
await app.listen({host:'127.0.0.1',port});
mkdirSync('validation/results',{recursive:true});mkdirSync('validation/evidence',{recursive:true});
const evidencePath=`validation/results/connected-public-${stamp}.json`;
const evidence={tested_at:new Date().toISOString(),kind:'live-external-connected-chrome',
  authorization:{source:'https://toscrape.com/',reviewed_at:'2026-10-16',scope:'Operator offers the fictional Books to Scrape sandbox for scraping and developer validation. Bounded public read-only requests.'},
  runtime:'Ephemeral isolated loopback runtime; owner workspace not used',checks:[],limitations:['Public read-only website only; authenticated sites, CAPTCHA, model generation, and service-worker restart not exercised by this script.']};
let context,cookie='',csrf='',stage='setup';
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const save=()=>writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
async function request(path,body,{key,headers={},allowFailure=false}={}){
  const owner=path.startsWith('/studio/');
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(owner?{cookie,'x-hermo-csrf':csrf}:{}),...(key?{authorization:'Bearer '+key}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
  if(owner&&response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const value=await response.json();if(!allowFailure)assert.ok(response.ok,`${path}: HTTP ${response.status}; ${value.error?.code??'request rejected'}`);
  return {status:response.status,value};
}
const owner=async(path,body)=>(await request(path,body)).value;
async function wait(receipt,key){
  for(let i=0;i<100;i++){const value=(await request((key?'/v1':'/studio')+'/runs/'+receipt.run_id,undefined,{key})).value;if(['succeeded','failed','cancelled'].includes(value.status))return value;await sleep(500);}
  throw Error('Run polling deadline');
}
function record(label,run){
  const safe={label,id:run.id,status:run.status,revision:run.workflow_revision,execution_mode:run.execution_mode,result:run.result,verification:run.verification,error:run.error,duration_ms:run.duration_ms};
  evidence.checks.push(safe);save();return run;
}
let rpcId=0;
async function mcp(method,params,key){
  const response=await request('/mcp',{jsonrpc:'2.0',id:++rpcId,method,params},{key,headers:{accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'}});
  assert.equal(response.value.error,undefined,'MCP protocol error');assert.notEqual(response.value.result?.isError,true,'MCP tool rejected request');return response.value.result;
}
try{
  csrf=(await owner('/studio/session')).csrf;
  csrf=(await owner('/studio/setup',{password:randomBytes(24).toString('hex')})).csrf;
  const source='https://books.toscrape.com/';
  const book='a-light-in-the-attic_1000',second='tipping-the-velvet_999';
  const expected={title:'A Light in the Attic',price:'£51.77'};
  const connection=(await owner('/studio/connections',{name:'Public Books authorized Chrome tab',url:source,access:'public',browser_mode:'connected',authorized:true})).connection;
  stage='launch actual Chrome and extension';
  context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,viewport:{width:1200,height:900},executablePath:process.env.HERMO_CHROME_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
  const cdp=await context.browser().newBrowserCDPSession();
  const {id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});
  const evaluate=async(targetId,expression)=>{
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});
    try{return await new Promise((done,reject)=>{
      const listener=event=>{if(event.sessionId!==sessionId)return;const data=JSON.parse(event.message);if(data.id!==74)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(data.error||data.result?.exceptionDetails)reject(Error('Companion evaluation failed'));else done(data.result.result.value);};
      const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Companion evaluation timed out'));},15000);
      cdp.on('Target.receivedMessageFromTarget',listener);
      cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:74,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,userGesture:true}})}).catch(reject);
    });}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
  };
  const site=await context.newPage();await site.goto(source+'catalogue/'+book+'/index.html',{waitUntil:'domcontentloaded'});
  assert.equal(await site.locator('.product_main h1').textContent(),expected.title);
  stage='explicit popup pairing';
  await site.bringToFront();
  const tab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(item=>item.url===site.url());assert.ok(tab);
  await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});
  let popup;
  for(let i=0;i<60;i++){popup=(await cdp.send('Target.getTargets')).targetInfos.find(item=>item.url.endsWith('/popup.html'));if(popup&&await evaluate(popup.targetId,"document.documentElement.dataset.hermoReady==='true'").catch(()=>false))break;await sleep(100);}
  assert.ok(popup,'Companion popup did not open');
  const grant=await owner(`/studio/connections/${connection.id}/browser-link`,{authorized:true});
  await evaluate(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
  for(let i=0;i<100;i++){if((await owner(`/studio/connections/${connection.id}/browser-link`)).linked)break;await sleep(100);}
  const linked=await owner(`/studio/connections/${connection.id}/browser-link`);assert.equal(linked.linked,true,'Explicit popup pairing failed');assert.equal(linked.confirmed,true,'Selected tab should connect without an account marker');
  await cdp.send('Target.closeTarget',{targetId:popup.targetId});
  evidence.checks.push({label:'actual companion popup explicitly authorizes exact public tab; no account confirmation',passed:true});
  // The authenticated control dashboard may close; it is not the runtime.
  const separator=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),domain:'127.0.0.1',path:'/studio',httpOnly:true,secure:false,sameSite:'Strict'}]);
  const dashboard=await context.newPage();await dashboard.goto(origin);await dashboard.close();
  let targets;
  const controlPage=item=>['page','tab'].includes(item.type)&&(item.url.startsWith(origin+'/')||/\/(popup|controller|connect)\.html/.test(item.url));
  for(let i=0;i<40;i++){targets=(await cdp.send('Target.getTargets')).targetInfos;if(!targets.some(controlPage))break;await sleep(100);}
  assert.equal(targets.some(controlPage),false,'Dashboard, popup and manual controller must be closed');
  evidence.checks.push({label:'dashboard and companion popup closed; no controller tab',passed:true});
  stage='record dynamic public page and actual detected outputs';
  const recording=await owner('/studio/recordings',{connection_id:connection.id,name:'Books public product API',slug:'acceptance.connected.books',action_type:'read_data'});
  await owner(`/studio/recordings/${recording.id}/navigate`,{template:source+'catalogue/{book}/index.html',parameter:'book',example:book});
  await owner(`/studio/recordings/${recording.id}/output`,{source:'url_parameter',name:'book'});
  const snapshot=await owner(`/studio/connections/${connection.id}/browser`);
  assert.equal(snapshot.can_confirm,true);
  for(const [name,value]of Object.entries(expected)){
    const element=snapshot.elements.find(item=>item.kind==='output'&&item.preview===value);assert.ok(element,`Real ${name} was not detected by the companion`);
    await owner(`/studio/recordings/${recording.id}/output`,{element_id:element.id,name});
  }
  const workflow=(await owner(`/studio/recordings/${recording.id}/finish`,{verifiers:[{output:'book',input:'book'},{kind:'nonempty',output:'title'},{kind:'nonempty',output:'price'}],timeout_seconds:45})).workflow;
  const tested=record('real external owner test, all control pages closed',await wait(await owner(`/studio/workflows/${workflow.id}/test`,{input:{book}})));
  assert.equal(tested.status,'succeeded');assert.deepEqual(tested.result,{book,...expected});assert.equal(tested.execution_mode,'connected_chrome');
  assert.ok(tested.verification.checks.includes('public_source_origin'));
  const published=await owner(`/studio/workflows/${workflow.id}/publish`,{}),key=published.key;assert.ok(key);
  stage='scoped REST fresh external read';
  const receipt=(await request('/v1/actions/acceptance.connected.books/versions/1/runs',{input:{book:second}},{key,headers:{'idempotency-key':randomUUID()}})).value;
  const rest=record('REST actual second book, dashboard and popup closed',await wait(receipt,key));
  assert.equal(rest.status,'succeeded');assert.deepEqual(rest.result,{book:second,title:'Tipping the Velvet',price:'£53.74'});assert.equal(rest.workflow_revision,1);
  stage='scoped MCP external read';
  const initialized=await mcp('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'hermo-public-acceptance',version:'1'}},key);assert.ok(initialized.serverInfo);
  const list=await mcp('tools/list',{},key),tool=list.tools.find(item=>item.name==='action_acceptance_connected_books');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);
  const mcpReceipt=(await mcp('tools/call',{name:tool.name,arguments:{input:{book},request_id:randomUUID()}},key)).structuredContent;
  let mcpRun;
  for(let i=0;i<100;i++){mcpRun=(await mcp('tools/call',{name:'get_run',arguments:{run_id:mcpReceipt.run_id}},key)).structuredContent;if(['succeeded','failed','cancelled'].includes(mcpRun.status))break;await sleep(500);}
  record('MCP same scoped engine, actual first book',mcpRun);assert.equal(mcpRun.status,'succeeded');assert.deepEqual(mcpRun.result,{book,...expected});assert.notEqual(mcpRun.id,rest.id);
  const screenshot=`validation/evidence/connected-public-book-${stamp}.png`;await site.screenshot({path:screenshot,fullPage:false});evidence.screenshot=screenshot;
  stage='authorized tab closure must fail explicitly';
  await site.close();
  for(let i=0;i<60;i++){if(!(await owner(`/studio/connections/${connection.id}/browser-link`)).linked)break;await sleep(100);}
  assert.equal((await owner(`/studio/connections/${connection.id}/browser-link`)).linked,false);
  const closed=await request('/v1/actions/acceptance.connected.books/versions/1/runs',{input:{book}},{key,headers:{'idempotency-key':randomUUID()},allowFailure:true});
  if(closed.status===202){const failed=record('closed authorized tab fails without result',await wait(closed.value,key));assert.notEqual(failed.status,'succeeded');assert.equal(failed.result,undefined);assert.ok(failed.error?.code);}
  else{assert.equal(closed.status,409);assert.ok(['CONNECTION_STOPPED','AUTH_REQUIRED','BROWSER_DISCONNECTED','TAB_UNAVAILABLE'].includes(closed.value.error?.code));evidence.checks.push({label:'closed authorized tab rejects new execution without stale output',http_status:closed.status,error:closed.value.error,result_present:Object.hasOwn(closed.value,'result')});assert.equal(Object.hasOwn(closed.value,'result'),false);}
  const health=(await request('/health')).value;assert.equal(health.status,'ok');assert.equal(health.dashboard_required,false);
  evidence.checks.push({label:'independent runtime remains healthy after dashboard and target tab close',passed:true});
  evidence.completed_at=new Date().toISOString();evidence.passed=true;save();console.log(`Connected Chrome external acceptance passed: ${evidencePath}`);
}catch(error){
  evidence.passed=false;evidence.failure={stage,name:error.name,message:String(error.message).replace(/hb_(?:pair|session)_[A-Za-z0-9_-]+|hm_live_[A-Za-z0-9_-]+/g,'[redacted]').slice(0,500)};save();console.error(`Connected Chrome acceptance failed at ${stage}: ${evidence.failure.message}`);process.exitCode=1;
}finally{
  await context?.close();await app.close();
  if(previousMaster===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMaster;
  evidence.cleanup={browser_closed:true,runtime_closed:true};save();
}
