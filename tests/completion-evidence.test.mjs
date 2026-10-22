import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';
import {validateWorkflowContract} from '../server/workflow-contract.mjs';
import {validateCompletionPolicy} from '../server/verification-rules.mjs';

const definition=steps=>({version:'completion-v1',steps,inputs:{},outputs:[
  {name:'result',type:'string',selector:'#result'},
  {name:'marker',type:'string',selector:'#marker'}
],verifiers:[{kind:'completion',output:'result',evidence:'marker'}],timeout_ms:15000});
async function fixture(t,body){
  let visits=0;
  const server=http.createServer((req,res)=>{visits++;res.writeHead(200,{'Content-Type':'text/html'});res.end(body);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,proxy=await createEgressProxy(origin),engine=await createBrowserEngine(proxy,origin);
  t.after(async()=>{await engine.closeAll();await proxy.close();await new Promise(resolve=>server.close(resolve));});
  const connection={id:'conn_completion_fixture',url:origin+'/sandbox/completion',origins:[origin],access:'public',identity:{kind:'public_origin',origin}};
  return {run:(value=definition([{op:'click',selector:'#action'}]))=>engine.execute(connection,value,{},()=>{},new AbortController().signal),get visits(){return visits;}};
}
const page=(action,extra='')=>`<button id="action" onclick="${action}">Search</button><output id="result">Identical answer</output><output id="marker">old</output>${extra}`;
const verificationFailure=error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.ok(['not_fresh','not_settled','completion_unverified'].includes(error.verification?.reason),JSON.stringify(error.verification));return true;};

test('managed execution accepts an identical result only with a changed stable completion marker',{timeout:30000},async t=>{
  const f=await fixture(t,page("document.querySelector('#marker').textContent='new'"));
  const run=await f.run();assert.deepEqual(run.result,{result:'Identical answer',marker:'new'});
  assert.ok(run.verification.checks.includes('result_completed_marker'));
});

test('a static completion marker cannot vouch for an existing identical result',{timeout:30000},async t=>{
  const f=await fixture(t,page(''));
  await assert.rejects(f.run(),verificationFailure);
});

test('a marker changed by filling before the last click does not prove that click completed',{timeout:30000},async t=>{
  const f=await fixture(t,page('',`<input id="query" oninput="document.querySelector('#marker').textContent='filled'">`));
  const value=definition([{op:'fill',selector:'#query',value:'new query'},{op:'click',selector:'#action'}]);
  await assert.rejects(f.run(value),verificationFailure);
});

test('completion evidence is checked again after later output extraction',{timeout:30000},async t=>{
  // A page-owned property getter changes the marker when the later result is
  // read, making the cross-output race deterministic without timer assumptions.
  const f=await fixture(t,page("document.querySelector('#marker').textContent='first'",`<script>const result=document.querySelector('#result');result.setAttribute('download','Identical answer');const original=result.getAttribute.bind(result);result.getAttribute=name=>{if(name==='download')document.querySelector('#marker').textContent='second';return original(name)}</script>`));
  const value=definition([{op:'click',selector:'#action'}]);value.outputs[0].read_attribute='download';
  await assert.rejects(f.run(value),error=>{assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification?.reason,'completion_unverified');return true;});
});

test('generated media cannot substitute a completion marker for fresh media evidence',{timeout:30000},async t=>{
  const value={...definition([{op:'click',selector:'#action'}]),action_type:'generate_media'};
  assert.equal(validateCompletionPolicy(value),false);
  assert.throws(()=>validateWorkflowContract(value),{message:'INVALID_WORKFLOW_CONTRACT'});
  const f=await fixture(t,page("document.querySelector('#marker').textContent='new'"));
  await assert.rejects(f.run(value),{message:'INVALID_WORKFLOW_CONTRACT'});assert.equal(f.visits,0);
});

test('managed structured extraction accepts nested integer mappings and validates their converted values',{timeout:30000},async t=>{
  const f=await fixture(t,'<article class="row"><span class="quantity">2</span></article>');
  const value={version:'nested-integer',steps:[],inputs:{},outputs:[{name:'records',type:'array',selector:'.row',items:{type:'object',fields:[{name:'quantity',type:'integer',selector:'.quantity',minimum:1,maximum:3}]}}],verifiers:[{kind:'nonempty',output:'records'}],timeout_ms:15000};
  assert.deepEqual((await f.run(value)).result,{records:[{quantity:2}]});
  value.outputs[0].items.fields[0].minimum=3;
  await assert.rejects(f.run(value),error=>{assert.equal(error.verification.reason,'below_minimum');assert.deepEqual(error.verification.path,['records',0,'quantity']);return true;});
});

test('managed completion rejects marker changes while the final action waits for readiness',{timeout:30000},async t=>{
  // Leave enough time for initial page inspection, then change the marker while
  // Search remains disabled. Clicking Search itself produces no new evidence.
  const f=await fixture(t,'<button id="action" disabled>Search</button><output id="result">Identical answer</output><output id="marker">old</output><script>setTimeout(()=>document.querySelector("#marker").textContent="new",800);setTimeout(()=>document.querySelector("#action").disabled=false,1200)</script>');
  await assert.rejects(f.run(),verificationFailure);
});

test('managed completion rejects marker changes while an overlay blocks the native final click',{timeout:30000},async t=>{
  const f=await fixture(t,'<button id="action">Search</button><output id="result">Identical answer</output><output id="marker">old</output><div id="cover" style="position:fixed;inset:0;background:white;z-index:100"></div><script>setTimeout(()=>document.querySelector("#marker").textContent="new",900);setTimeout(()=>document.querySelector("#cover").remove(),1400)</script>');
  await assert.rejects(f.run(),verificationFailure);
});
