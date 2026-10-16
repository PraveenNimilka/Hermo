import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright';
import {installConnectedBrowser} from '../server/connected-browser.mjs';
import {hash} from '../server/store.mjs';
import {startRun,observeProgress,finishRun} from '../server/run-state.mjs';
import {executeBrowserCommand,operateDocument} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';

async function fixture(t,html){
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  t.after(()=>browser.close());
  const page=await browser.newPage();await page.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://example.com/task');
  const chrome={tabs:{get:async()=>({url:page.url(),status:'complete',windowId:1}),update:async(_,{url})=>{if(url)await page.goto(url);}},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
  const run=command=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command,inspect:inspectDocument,deadline:Date.now()+5000});
  return {page,chrome,run};
}

test('semantic targets resolve exact names and fail ambiguous strong candidates before CSS fallback',async t=>{
  const {page,run}=await fixture(t,'<label for="q">Search query</label><input id="q"><button data-testid="submit" onclick="window.clicked=(window.clicked||0)+1">Search</button><button id="other" onclick="window.unintendedClick=true">Other</button>');
  await run({op:'operate',kind:'fill',locators:[{kind:'label',value:'Search query'}],value:'books'});
  assert.equal(await page.locator('#q').inputValue(),'books');
  await run({op:'operate',kind:'click',locators:[{kind:'css',value:'#missing-old-selector'},{kind:'role',role:'button',name:'Search'}]});
  assert.equal(await page.evaluate(()=>window.clicked),1);
  await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<button data-testid="submit">Duplicate</button>'));
  await assert.rejects(run({op:'operate',kind:'click',selector:'#other',locators:[{kind:'testId',value:'submit'}]}),{message:'ELEMENT_AMBIGUOUS'});
  assert.equal(await page.evaluate(()=>window.unintendedClick),undefined);
  const invalid=await page.evaluate(operateDocument,{op:'observe',kind:'element',state:'hidden',selector:'button',origin:'https://example.com',path_prefix:'/'});
  assert.deepEqual(invalid,{hermo_error:'ELEMENT_AMBIGUOUS'});
});

test('state observations support hidden, visible, enabled, text and origin-scoped URL conditions',async t=>{
  const {page,run}=await fixture(t,'<p id="status" hidden>Pending</p><button id="submit" disabled>Submit</button>');
  const observe=(selector,state)=>run({op:'observe',kind:'element',selector,state});
  assert.equal(await observe('#missing','hidden'),true);assert.equal(await observe('#status','visible'),false);assert.equal(await observe('#submit','enabled'),false);
  await page.evaluate(()=>{document.querySelector('#status').hidden=false;document.querySelector('#status').textContent='Search completed successfully';document.querySelector('#submit').disabled=false;history.replaceState({},'','/results?query=book');});
  assert.equal(await observe('#status','visible'),true);assert.equal(await observe('#submit','enabled'),true);
  assert.equal(await run({op:'observe',kind:'text',selector:'#status',text:'completed'}),true);
  assert.equal(await run({op:'observe',kind:'text',selector:'#status',text:'missing'}),false);
  assert.equal(await run({op:'observe',kind:'text',selector:'#status',text:'completed  successfully'}),false,'text waiting uses a literal substring rather than changing whitespace semantics');
  assert.equal(await run({op:'observe',kind:'url',url:'https://example.com/results',match:'contains'}),true);
  assert.equal(await run({op:'observe',kind:'url',url:'https://example.com/results',match:'exact'}),false);
  assert.equal(await run({op:'observe',kind:'url',url:'https://example.com/results?query=book',match:'exact'}),true);
  await assert.rejects(run({op:'observe',kind:'url',url:'https://evil.example/results',match:'contains'}),{message:'ORIGIN_CHANGED'});
  await assert.rejects(run({op:'observe',kind:'text',selector:'#status',text:'x'.repeat(2001)}),{message:'ACTION_UNAVAILABLE'});
});

async function connectedAdapter(t,fixture){
  const handlers=new Map(),app={post:(path,...args)=>handlers.set('POST '+path,args.at(-1)),get:(path,...args)=>handlers.set('GET '+path,args.at(-1)),options:()=>{}};
  const owner='synthetic-owner-cookie',extension='a'.repeat(32),sessions=new Map([[hash(owner),{authenticated:true,expires:Date.now()+60000}]]);
  let connection={id:'conn_synthetic',name:'Synthetic website',url:'https://example.com/task',origins:['https://example.com'],access:'public',status:'connected',browser_mode:'connected',identity:{kind:'selected_tab',origin:'https://example.com'}};
  const fail=code=>{throw Error(code);},calls=[];
  const engine=installConnectedBrowser(app,{origin:'http://127.0.0.1:4318',store:{audit:()=>{}},session:()=>({authenticated:true}),sessions,ownerCookie:'owner',connection:()=>connection,saveConnection:(_,changes,status)=>{connection={...connection,...changes,status};},invalidate:()=>{},recordings:new Map(),fail,rate:()=>{},stopRuns:()=>{},browserWorkspaces:{},connectionBusy:()=>false,isRecording:()=>false,baseEngine:{close:async()=>{},closeAll:async()=>{}}});
  const invoke=(path,body,extra={})=>handlers.get('POST '+path)({method:'POST',body,params:{cid:connection.id},cookies:{owner},headers:{'x-hermo-extension-id':extension,...extra}}, {raw:new EventEmitter()});
  const grant=await invoke('/studio/connections/:cid/browser-link',{authorized:true});
  const pair=await invoke('/companion/browser/pair',{code:grant.code,origin:'https://example.com',authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs'],context_id:'bc_'+'a'.repeat(36),tab_id:1});
  const authorization={authorization:'Bearer '+pair.token};let running=true;
  const pump=(async()=>{while(running){const message=await invoke('/companion/browser/poll',{},authorization);if(message.type==='closed')break;if(message.type!=='command')continue;calls.push(message.command);let value,error;
    try{value=await executeBrowserCommand({chrome:fixture.chrome,tabId:1,origin:message.origin,pathPrefix:message.path_prefix,command:message.command,inspect:inspectDocument,deadline:message.expires_at,beforeMutation:()=>invoke('/companion/browser/authorize',{id:message.id},authorization)});}catch(problem){error=problem.message;}
    if(running)await invoke('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}},authorization);
  }})();
  t.after(async()=>{running=false;await engine.closeAll();await pump;});
  return {engine,connection:()=>connection,calls};
}

test('connected execution polls real DOM waits, skips disabled actions and never treats a wait as submission',async t=>{
  const f=await fixture(t,'<button id="danger" onclick="window.dangerClicked=true">Danger</button><button data-testid="run" onclick="setTimeout(()=>{document.querySelector(\'#result\').textContent=\'Ready result\';history.replaceState({},\'\',\'/complete\');},150)">Run</button><p id="result">Pending</p>');
  const {engine,connection,calls}=await connectedAdapter(t,f);
  const definition={version:'wait-test',inputs:{},outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'contains',output:'result',value:'Ready'}],effect:'recorded_browser_actions',steps:[{op:'click',selector:'#danger',enabled:false},{op:'click',locators:[{kind:'testId',value:'run'}]},{op:'wait_text',selector:'#result',text:'Ready',timeout_ms:2000},{op:'wait_url',url:'https://example.com/complete',match:'exact',timeout_ms:2000},{op:'wait_element',selector:'#absent',state:'hidden',timeout_ms:1000}]};
  const accepted=new Date().toISOString(),payload={};startRun(payload,definition,accepted);
  const result=await engine.execute(connection(),definition,{},(index,total,event)=>observeProgress(payload,definition,index,total,event),new AbortController().signal);
  finishRun(payload,'succeeded',accepted);
  assert.equal(result.result.result,'Ready result');assert.equal(await f.page.evaluate(()=>window.dangerClicked),undefined);
  assert.equal(payload.steps[0].status,'skipped');assert.equal(payload.steps[2].status,'succeeded');
  assert.equal(calls.filter(call=>call.op==='operate').length,1);assert.ok(calls.some(call=>call.op==='observe'&&call.kind==='text'));
  const readOnly={...definition,effect:'retrieval',steps:[{op:'wait_element',selector:'#result',state:'visible',timeout_ms:1000}]},readPayload={};startRun(readPayload,readOnly,accepted);
  await engine.execute(connection(),readOnly,{},(index,total,event)=>observeProgress(readPayload,readOnly,index,total,event),new AbortController().signal);
  assert.equal(readPayload.submission_may_have_occurred,undefined);
  await f.page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<button data-testid="run">Duplicate run</button>'));
  await assert.rejects(engine.execute(connection(),{...definition,steps:[{op:'click',selector:'#danger',locators:[{kind:'testId',value:'run'}]}]},{},()=>{},new AbortController().signal),{message:'ELEMENT_AMBIGUOUS'});
  assert.equal(await f.page.evaluate(()=>window.dangerClicked),undefined);
});

test('connected wait timeout and cancellation prevent all later mutations',async t=>{
  const f=await fixture(t,'<button id="danger" onclick="window.dangerClicked=true">Danger</button><p id="result">Existing result</p>');
  const {engine,connection,calls}=await connectedAdapter(t,f);
  const definition={version:'timeout-test',inputs:{},outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'nonempty',output:'result'}],steps:[{op:'wait_element',selector:'#never-appears',state:'visible',timeout_ms:150},{op:'click',selector:'#danger'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),{message:'TIMEOUT'});
  assert.equal(calls.some(call=>call.op==='operate'),false);assert.equal(await f.page.evaluate(()=>window.dangerClicked),undefined);
  const controller=new AbortController(),pending=engine.execute(connection(),{...definition,steps:[{...definition.steps[0],timeout_ms:2000},definition.steps[1]]},{},()=>{},controller.signal);
  setTimeout(()=>controller.abort(Error('WORKFLOW_CANCELLED')),50);
  await assert.rejects(pending,{message:'WORKFLOW_CANCELLED'});
  assert.equal(calls.some(call=>call.op==='operate'),false);assert.equal(await f.page.evaluate(()=>window.dangerClicked),undefined);
});
