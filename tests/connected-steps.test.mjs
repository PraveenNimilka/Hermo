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
  await page.locator('button').filter({hasText:'Search'}).evaluate(el=>{el.textContent='Delete';el.id='old-search';});
  await assert.rejects(run({op:'operate',kind:'click',selector:'#old-search',locators:[{kind:'role',role:'button',name:'Search'}]}),{message:'ELEMENT_CHANGED'});
  await assert.rejects(run({op:'operate',kind:'click',locators:[{kind:'testId',value:'submit'},{kind:'role',role:'button',name:'Search'}]}),{message:'ELEMENT_AMBIGUOUS'});
  await page.locator('button').filter({hasText:'Duplicate'}).evaluate(el=>el.remove());
  await assert.rejects(run({op:'operate',kind:'click',locators:[{kind:'testId',value:'submit'},{kind:'role',role:'button',name:'Search'}]}),{message:'ELEMENT_CHANGED'});
  assert.equal(await page.evaluate(()=>window.clicked),1,'a repurposed unique target is never clicked');
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

async function connectedAdapter(t,fixture,semanticGuard=true,completionGuard=true,locatorProbe=true,extendedWaits=true){
  const handlers=new Map(),app={post:(path,...args)=>handlers.set('POST '+path,args.at(-1)),get:(path,...args)=>handlers.set('GET '+path,args.at(-1)),options:()=>{}};
  const owner='synthetic-owner-cookie',extension='a'.repeat(32),sessions=new Map([[hash(owner),{authenticated:true,expires:Date.now()+60000}]]);
  let connection={id:'conn_synthetic',name:'Synthetic website',url:'https://example.com/task',origins:['https://example.com'],access:'public',status:'connected',browser_mode:'connected',identity:{kind:'selected_tab',origin:'https://example.com'}};
  const fail=code=>{throw Error(code);},calls=[];
  const engine=installConnectedBrowser(app,{origin:'http://127.0.0.1:4318',store:{audit:()=>{}},session:()=>({authenticated:true}),sessions,ownerCookie:'owner',connection:()=>connection,saveConnection:(_,changes,status)=>{connection={...connection,...changes,status};},invalidate:()=>{},recordings:new Map(),fail,rate:()=>{},stopRuns:()=>{},browserWorkspaces:{},connectionBusy:()=>false,isRecording:()=>false,baseEngine:{close:async()=>{},closeAll:async()=>{}}});
  const invoke=(path,body,extra={})=>handlers.get('POST '+path)({method:'POST',body,params:{cid:connection.id},cookies:{owner},headers:{'x-hermo-extension-id':extension,...extra}}, {raw:new EventEmitter()});
  const grant=await invoke('/studio/connections/:cid/browser-link',{authorized:true});
  const pair=await invoke('/companion/browser/pair',{code:grant.code,origin:'https://example.com',authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs',...extendedWaits?['extended_waits','typed_outputs']:[],...locatorProbe?['locator_probe']:[],...completionGuard?['completion_evidence']:[],...semanticGuard?['semantic_target_guard']:[]],context_id:'bc_'+'a'.repeat(36),tab_id:1});
  const authorization={authorization:'Bearer '+pair.token};let running=true;
  const pump=(async()=>{while(running){const message=await invoke('/companion/browser/poll',{},authorization);if(message.type==='closed')break;if(message.type!=='command')continue;calls.push(message.command);let value,error;
    try{value=await executeBrowserCommand({chrome:fixture.chrome,tabId:1,origin:message.origin,pathPrefix:message.path_prefix,command:message.command,inspect:inspectDocument,deadline:message.expires_at,beforeMutation:()=>invoke('/companion/browser/authorize',{id:message.id},authorization)});}catch(problem){error=problem.message;}
    if(running)await invoke('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}},authorization);
  }})();
  t.after(async()=>{running=false;await engine.closeAll();await pump;});
  return {engine,connection:()=>connection,calls};
}

test('connected extended waits use typed observations, preserve continuation warnings and never replay actions',async t=>{
  const f=await fixture(t,'<output id="answer">0</output><output id="flag">false</output><output id="none">null</output><label for="query">Query</label><input id="query"><button id="submit" onclick="window.submitted=(window.submitted||0)+1">Submit</button>'),{engine,connection,calls}=await connectedAdapter(t,f);
  const steps=[{op:'wait_navigation',state:'load',url:'https://example.com/task',timeout_ms:1000},{op:'wait_output',output:'answer',predicate:'equals',value:0},{op:'wait_output',output:'flag',predicate:'equals',value:false},{op:'wait_output',output:'none',predicate:'equals',value:null},{op:'wait_delay',duration_ms:100},{op:'wait_text',selector:'#answer',text:'missing',timeout_ms:250,error_policy:'continue'},{op:'fill',selector:'#query',parameter:'request',value_path:['query']},{op:'click',selector:'#submit'}];
  const definition={version:'connected-extended-waits',steps,inputs:{request:{type:'object',required:true,properties:{query:{type:'string',required:true}}}},outputs:[{name:'answer',selector:'#answer',type:'number'},{name:'flag',selector:'#flag',type:'boolean'},{name:'none',selector:'#none',type:'null'}],verifiers:[{kind:'nonempty',output:'answer'}],timeout_ms:15000};
  const payload={};startRun(payload,definition,new Date().toISOString());
  const result=await engine.execute(connection(),definition,{request:{query:'nested value'}},(index,total,event)=>observeProgress(payload,definition,index,total,event));
  assert.deepEqual(result.result,{answer:0,flag:false,none:null});assert.equal(payload.steps[5].status,'skipped');assert.equal(payload.steps[5].warning,'WAIT_TIMEOUT_CONTINUED');
  assert.equal(await f.page.inputValue('#query'),'nested value');assert.equal(await f.page.evaluate(()=>window.submitted),1);assert.equal(calls.filter(command=>command.op==='operate'&&command.kind==='click').length,1);
});

test('connected waits stop on deadline or cancellation without reaching later actions',async t=>{
  const f=await fixture(t,'<output id="answer">Ready</output><button id="submit" onclick="window.submitted=true">Submit</button>'),{engine,connection}=await connectedAdapter(t,f);
  const definition={version:'connected-wait-deadline',steps:[{op:'wait_text',selector:'#answer',text:'missing',timeout_ms:250},{op:'click',selector:'#submit'}],inputs:{},outputs:[{name:'answer',selector:'#answer'}],verifiers:[{kind:'nonempty',output:'answer'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{}),{message:'TIMEOUT'});
  const controller=new AbortController();let entered;const ready=new Promise(resolve=>entered=resolve);
  const pending=engine.execute(connection(),{...definition,steps:[{op:'wait_delay',duration_ms:10000,error_policy:'continue'},{op:'click',selector:'#submit'}]}, {},(index,_total,event)=>{if(index===0&&!event)entered();},controller.signal);
  await ready;controller.abort(Error('WORKFLOW_CANCELLED'));await assert.rejects(pending,{message:'WORKFLOW_CANCELLED'});assert.equal(await f.page.evaluate(()=>window.submitted),undefined);
});

test('older companion links reject new navigation and null extraction before unsupported commands',async t=>{
  const f=await fixture(t,'<output id="answer">null</output>'),{engine,connection,calls}=await connectedAdapter(t,f,true,true,true,false);
  const definition={version:'old-wait-support',steps:[{op:'wait_navigation',state:'load'}],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'null'}],verifiers:[]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{}),{message:'COMPANION_UPDATE_REQUIRED'});assert.equal(calls.filter(command=>command.op==='observe'||command.op==='extract').length,0);
});

test('negotiated locator observations read only the selected page and never issue an input command',async t=>{
  const f=await fixture(t,'<label for="q">Search query</label><input id="q" value="PRIVATE_VALUE"><button id="new-search" data-testid="search" onclick="window.submissions=(window.submissions||0)+1">Search</button>');
  const {engine,calls}=await connectedAdapter(t,f);
  const observed=await engine.probeTarget('conn_synthetic',{mode:'candidates',selector:'#old-search',locators:[{kind:'role',role:'button',name:'Search'}],operation:'click',limit:8});
  assert.equal(observed.matches,1);const candidate=observed.candidates.find(value=>value.name==='Search');assert.ok(candidate);
  const probed=await engine.probeTarget('conn_synthetic',{mode:'probe',selector:candidate.selector,locators:candidate.locators,operation:'click'});
  assert.equal(probed.matches,1);assert.equal(probed.element_id,candidate.element_id);assert.equal(probed.document_id,observed.document_id);
  assert.equal(await f.page.evaluate(()=>window.submissions),undefined);assert.equal(calls.length,2);assert.ok(calls.every(command=>command.op==='locator_probe'));
  assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_VALUE/);
  await assert.rejects(engine.probeTarget('conn_synthetic',{mode:'probe',selector:'#q',operation:'fill'},['iframe']),{message:'UNSUPPORTED_FRAME'});
});

test('older companions reject locator inspection before any selected-page command',async t=>{
  const f=await fixture(t,'<button>Search</button>'),{engine,calls}=await connectedAdapter(t,f,true,true,false);
  await assert.rejects(engine.probeTarget('conn_synthetic',{mode:'probe',selector:'button',operation:'click'}),{message:'COMPANION_UPDATE_REQUIRED'});
  assert.equal(calls.length,0);
});

test('connected output-only invocation approval precedes all selected-page commands',{timeout:30000},async t=>{
  const f=await fixture(t,'<output id="result">Approved read</output>'),{engine,connection,calls}=await connectedAdapter(t,f);
  const definition={version:'invocation-connected',approval_policy:{mode:'every_invocation'},effect:'retrieval',steps:[],inputs:{},outputs:[{name:'answer',selector:'#result'}],verifiers:[{kind:'nonempty',output:'answer'}],timeout_ms:15000};
  const execute=(signal,beforeStep)=>engine.execute(connection(),definition,{},()=>{},signal,beforeStep);
  await assert.rejects(execute(new AbortController().signal),{message:'APPROVAL_REQUIRED'});assert.equal(calls.length,0);
  await assert.rejects(execute(new AbortController().signal,async index=>{assert.equal(index,-1);assert.equal(calls.length,0);throw Error('APPROVAL_REJECTED');}),{message:'APPROVAL_REJECTED'});assert.equal(calls.length,0);
  const controller=new AbortController();let release,entered;const paused=new Promise(done=>entered=done);
  const pending=execute(controller.signal,index=>{assert.equal(index,-1);entered();return new Promise(done=>release=done);});
  await paused;assert.equal(calls.length,0);controller.abort(Error('WORKFLOW_CANCELLED'));await assert.rejects(pending,{message:'WORKFLOW_CANCELLED'});release();await new Promise(done=>setTimeout(done,20));assert.equal(calls.length,0);
  const result=await execute(new AbortController().signal,async index=>{assert.equal(index,-1);assert.equal(calls.length,0);});
  assert.deepEqual(result.result,{answer:'Approved read'});assert.ok(calls.some(command=>command.op==='snapshot'));assert.equal(calls.some(command=>command.op==='operate'),false);
});

test('connected execution polls real DOM waits, skips disabled actions and never treats a wait as submission',async t=>{
  const f=await fixture(t,'<button id="danger" onclick="window.dangerClicked=true">Danger</button><button data-testid="run" onclick="setTimeout(()=>{document.querySelector(\'#result\').textContent=\'Ready result\';history.replaceState({},\'\',\'/complete\');},150)">Run</button><p id="result">Pending</p>');
  const {engine,connection,calls}=await connectedAdapter(t,f);
  const definition={version:'wait-test',inputs:{},outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'contains',output:'result',value:'Ready'}],effect:'recorded_browser_actions',steps:[{op:'click',selector:'#danger',enabled:false},{op:'click',locators:[{kind:'testId',value:'run'}]},{op:'wait_text',selector:'#result',text:'Ready',timeout_ms:2000},{op:'wait_url',url:'https://example.com/complete',match:'exact',timeout_ms:2000},{op:'wait_element',selector:'#absent',state:'hidden',timeout_ms:1000}]};
  const accepted=new Date().toISOString(),payload={};startRun(payload,definition,accepted);
  const result=await engine.execute(connection(),definition,{},(index,total,event)=>observeProgress(payload,definition,index,total,event),new AbortController().signal);
  payload.verification=result.verification;
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

test('an older companion cannot silently skip a recorded semantic mutation guard',async t=>{
  const f=await fixture(t,'<button id="submit" onclick="window.clicked=true">Search</button><p id="result">Existing result</p>');
  const {engine,connection,calls}=await connectedAdapter(t,f,false);
  const definition={version:'old-companion-guard',effect:'recorded_browser_actions',inputs:{},steps:[{op:'click',selector:'#submit',locators:[{kind:'role',role:'button',name:'Search'}]}],outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'nonempty',output:'result'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),{message:'COMPANION_UPDATE_REQUIRED'});
  assert.equal(calls.some(command=>command.op==='operate'),false);assert.equal(await f.page.evaluate(()=>window.clicked),undefined);
  assert.equal(engine.isOpen(connection().id),true,'updating is required without dropping the authorized tab');
});

test('connected completion accepts identical latest output with a changed stable marker',{timeout:30000},async t=>{
  const f=await fixture(t,'<button id="action" onclick="document.querySelector(\'#marker\').textContent=\'new\'">Search</button><output id="result">Identical answer</output><output id="marker">old</output>');
  const {engine,connection}=await connectedAdapter(t,f);
  const definition={version:'completion-connected',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'click',selector:'#action'}],outputs:[{name:'result',type:'string',selector:'#result',read_mode:'last'},{name:'marker',type:'string',selector:'#marker'}],verifiers:[{kind:'completion',output:'result',evidence:'marker'}]};
  const run=await engine.execute(connection(),definition,{},()=>{},new AbortController().signal);
  assert.deepEqual(run.result,{result:'Identical answer',marker:'new'});assert.ok(run.verification.checks.includes('result_completed_marker'));
});

test('connected completion rejects a static marker for identical latest output',{timeout:30000},async t=>{
  const f=await fixture(t,'<button id="action">Search</button><output id="result">Identical answer</output><output id="marker">old</output>');
  const {engine,connection}=await connectedAdapter(t,f);
  const definition={version:'completion-connected',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'click',selector:'#action'}],outputs:[{name:'result',type:'string',selector:'#result',read_mode:'last'},{name:'marker',type:'string',selector:'#marker'}],verifiers:[{kind:'completion',output:'result',evidence:'marker'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification?.output,'marker');assert.ok(['not_fresh','not_settled'].includes(error.verification.reason));return true;});
});

test('connected completion captures marker freshness at the last action rather than an earlier fill',{timeout:30000},async t=>{
  const f=await fixture(t,'<input id="query" oninput="document.querySelector(\'#marker\').textContent=\'filled\'"><button id="action">Search</button><output id="result">Identical answer</output><output id="marker">old</output>');
  const {engine,connection}=await connectedAdapter(t,f);
  const definition={version:'completion-connected',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'fill',selector:'#query',value:'new query'},{op:'click',selector:'#action'}],outputs:[{name:'result',type:'string',selector:'#result',read_mode:'last'},{name:'marker',type:'string',selector:'#marker'}],verifiers:[{kind:'completion',output:'result',evidence:'marker'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification?.output,'marker');assert.ok(['not_fresh','not_settled'].includes(error.verification.reason));return true;});
});

test('connected completion rechecks evidence after a later output read changes the marker',{timeout:30000},async t=>{
  const f=await fixture(t,'<button id="action" onclick="document.querySelector(\'#marker\').textContent=\'first\'">Search</button><output id="result" download="Identical answer">Identical answer</output><output id="marker">old</output><script>const result=document.querySelector("#result"),original=result.getAttribute.bind(result);result.getAttribute=name=>{if(name==="download")document.querySelector("#marker").textContent="second";return original(name)}</script>');
  const {engine,connection}=await connectedAdapter(t,f);
  const definition={version:'completion-connected',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'click',selector:'#action'}],outputs:[{name:'result',type:'string',selector:'#result',read_attribute:'download'},{name:'marker',type:'string',selector:'#marker'}],verifiers:[{kind:'completion',output:'result',evidence:'marker'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification?.reason,'completion_unverified');return true;});
});

test('connected integer constraints retain nested types across the companion extraction wire',{timeout:30000},async t=>{
  const f=await fixture(t,'<article class="row"><span class="count">2</span><section class="details"><span class="rank">4</span></section></article>');
  const {engine,connection,calls}=await connectedAdapter(t,f);
  const definition={version:'integer-connected',effect:'retrieval',timeout_ms:15000,inputs:{},steps:[],outputs:[{name:'rows',type:'array',selector:'.row',items:{type:'object',fields:[{name:'count',type:'integer',selector:'.count',minimum:1,maximum:3},{name:'details',type:'object',selector:'.details',fields:[{name:'rank',type:'integer',selector:'.rank',minimum:1,maximum:5}]}]}}],verifiers:[{kind:'nonempty',output:'rows'}]};
  const run=()=>engine.execute(connection(),definition,{},()=>{},new AbortController().signal);
  assert.deepEqual((await run()).result,{rows:[{count:2,details:{rank:4}}]});
  const wire=calls.find(command=>command.op==='extract').mapping;
  assert.equal(wire.items.fields[0].type,'number');assert.equal(wire.items.fields[1].fields[0].type,'number');
  assert.equal(definition.outputs[0].items.fields[0].type,'integer','wire compatibility does not weaken the accepted contract');
  await f.page.locator('.rank').evaluate(element=>{element.textContent='4.5';});
  await assert.rejects(run(),error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.deepEqual(error.verification,{output:'rows',reason:'invalid_integer',path:['rows',0,'details','rank'],keyword:'type'});return true;});
  await f.page.locator('.rank').evaluate(element=>{element.textContent='6';});
  await assert.rejects(run(),error=>{assert.equal(error.verification?.reason,'above_maximum');assert.deepEqual(error.verification.path,['rows',0,'details','rank']);return true;});
});

test('connected completion rejects marker changes while the final action waits for readiness',{timeout:30000},async t=>{
  const f=await fixture(t,'<button id="action" disabled>Search</button><output id="result">Identical answer</output><output id="marker">old</output>');
  const {engine,connection}=await connectedAdapter(t,f);
  await f.page.evaluate(()=>{setTimeout(()=>document.querySelector('#marker').textContent='new',150);setTimeout(()=>document.querySelector('#action').disabled=false,300);});
  const definition={version:'completion-readiness',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'click',selector:'#action'}],outputs:[{name:'result',type:'string',selector:'#result',read_mode:'last'},{name:'marker',type:'string',selector:'#marker'}],verifiers:[{kind:'completion',output:'result',evidence:'marker'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification?.output,'marker');assert.ok(['not_fresh','not_settled'].includes(error.verification.reason));return true;});
});

test('connected completion rejects a marker changed during the second action readiness wait',{timeout:30000},async t=>{
  const f=await fixture(t,'<button id="action" onclick="window.clicked=true">Search</button><output id="result">Identical answer</output><output id="marker">old</output>');
  const {engine,connection}=await connectedAdapter(t,f);
  await f.page.evaluate(()=>{
    const marker=document.querySelector('#marker'),original=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'innerText').get;
    window.markerReads=0;
    Object.defineProperty(marker,'innerText',{get(){
      // Snapshot discovery also reads text. Only action-output reads establish
      // the two completion baselines exercised by this regression.
      if(new Error().stack.includes('operateDocument')&&++window.markerReads===2){
        document.querySelector('#action').disabled=true;window.secondReadDisabled=true;
        setTimeout(()=>{marker.textContent='new';window.changedBeforeClick=!window.clicked;},150);
        setTimeout(()=>document.querySelector('#action').disabled=false,300);
      }
      return original.call(this);
    }});
  });
  const definition={version:'completion-second-readiness',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'click',selector:'#action'}],outputs:[{name:'result',type:'string',selector:'#result',read_mode:'last'},{name:'marker',type:'string',selector:'#marker'}],verifiers:[{kind:'completion',output:'result',evidence:'marker'}]};
  try{
    await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification?.output,'marker');return true;});
  }finally{
    assert.equal(await f.page.evaluate(()=>window.secondReadDisabled),true,'the baseline getter disabled the already-observed action');
    assert.equal(await f.page.evaluate(()=>window.changedBeforeClick),true,'the changed marker predates the actual click');
  }
});

test('completion capability is required before any earlier workflow fill is issued',{timeout:30000},async t=>{
  const f=await fixture(t,'<input id="query"><button id="action" onclick="window.clicked=true">Search</button><output id="result">Identical answer</output><output id="marker">old</output>');
  const {engine,connection,calls}=await connectedAdapter(t,f,true,false);
  const definition={version:'completion-capability',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'fill',selector:'#query',value:'must not fill'},{op:'click',selector:'#action'}],outputs:[{name:'result',selector:'#result'},{name:'marker',selector:'#marker'}],verifiers:[{kind:'completion',output:'result',evidence:'marker'}]};
  await assert.rejects(engine.execute(connection(),definition,{},()=>{},new AbortController().signal),{message:'COMPANION_UPDATE_REQUIRED'});
  assert.equal(calls.some(command=>command.op==='operate'),false);assert.equal(await f.page.locator('#query').inputValue(),'');assert.equal(await f.page.evaluate(()=>window.clicked),undefined);
  assert.equal(engine.isOpen(connection().id),true);
});

test('completion guard command bounds reject executable selectors and oversized data before input',{timeout:30000},async t=>{
  const {page,run}=await fixture(t,'<button id="action" onclick="window.clicked=true">Search</button><output id="marker">old</output>');
  const guard={selector:'#marker',expected:'old'};
  const invalid=[[],Array.from({length:9},()=>guard),[null],[{...guard,selector:'javascript:alert(1)'}],[{...guard,selector:'div => window.clicked=true'}],[{...guard,selector:'x'.repeat(3001)}],[{...guard,expected:'x'.repeat(4097)}],[{...guard,expected:{secret:'DO_NOT_DISCLOSE'}}]];
  for(const completion_guard of invalid)await assert.rejects(run({op:'operate',kind:'click',selector:'#action',completion_guard}),{message:'ACTION_UNAVAILABLE'});
  assert.equal(await page.evaluate(()=>window.clicked),undefined);
});

test('completion guard rejects ambiguous editable or changed marker data without exposing its value',{timeout:30000},async t=>{
  const {page,run}=await fixture(t,'<button id="action" onclick="window.clicked=true">Search</button><output id="marker">DO_NOT_DISCLOSE</output><output class="duplicate">old</output><output class="duplicate">old</output><textarea id="secret">DO_NOT_DISCLOSE</textarea><output id="busy" aria-busy="true">old</output>');
  for(const guard of [{selector:'.duplicate',expected:'old'},{selector:'#secret',expected:'DO_NOT_DISCLOSE'},{selector:'#marker',expected:'old'},{selector:'#busy',expected:'old'}]){
    await assert.rejects(run({op:'operate',kind:'click',selector:'#action',completion_guard:[guard]}),error=>{assert.equal(error.message,'COMPLETION_CHANGED');assert.equal(JSON.stringify(error).includes('DO_NOT_DISCLOSE'),false);return true;});
    assert.equal(await page.evaluate(()=>window.clicked),undefined);
  }
});
