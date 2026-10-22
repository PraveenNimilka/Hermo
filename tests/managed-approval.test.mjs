import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';

async function fixture(t){
  let mutations=0,visits=0,body='<button id="action" data-testid="action" onclick="document.querySelector(\'#result\').textContent=\'Done\';fetch(\'/sandbox/mutation\')">Search</button><output id="result">Ready</output>';
  const server=http.createServer((req,res)=>{
    if(req.url==='/sandbox/mutation'){mutations++;res.end('Observed');return;}
    if(req.url==='/sandbox/done'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<output id="result">Done</output>');return;}
    visits++;res.writeHead(200,{'Content-Type':'text/html'});res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,proxy=await createEgressProxy(origin),engine=await createBrowserEngine(proxy,origin);
  t.after(async()=>{await engine.closeAll();await proxy.close();await new Promise(resolve=>server.close(resolve));});
  const connection={id:'conn_approval_fixture',url:origin+'/sandbox/approval',origins:[origin],access:'public',identity:{kind:'public_origin',origin}};
  const definition={steps:[{op:'wait_text',selector:'#result',text:'Ready'},{op:'click',selector:'#action',locators:[{kind:'testId',value:'action'},{kind:'role',role:'button',name:'Search'}],approval_required:true}],inputs:{},outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'changed',output:'result'}],timeout_ms:15000};
  const run=(steps=definition.steps,signal=new AbortController().signal,beforeStep)=>engine.execute(connection,{...definition,steps},{},()=>{},signal,beforeStep);
  return {run,get mutations(){return mutations;},get visits(){return visits;},get body(){return body;},set body(value){body=value;}};
}

test('managed owner checkpoints fail closed and execute only after the selected approval',{timeout:30000},async t=>{
  const f=await fixture(t);
  await assert.rejects(f.run(),{message:'APPROVAL_REQUIRED'});assert.equal(f.visits,0);assert.equal(f.mutations,0);
  let approve,reached;const atCheckpoint=new Promise(resolve=>reached=resolve),decision=new Promise(resolve=>approve=resolve),indices=[];
  const execution=f.run(undefined,undefined,async index=>{indices.push(index);reached();await decision;});
  await atCheckpoint;assert.equal(f.mutations,0);assert.deepEqual(indices,[1]);
  approve();assert.deepEqual((await execution).result,{result:'Done'});assert.equal(f.mutations,1);
});

test('cancelling an owner checkpoint prevents late approval from executing the action',{timeout:30000},async t=>{
  const f=await fixture(t),controller=new AbortController();
  let reached,approve;const atCheckpoint=new Promise(resolve=>reached=resolve),decision=new Promise(resolve=>approve=resolve);
  const execution=f.run(undefined,controller.signal,async()=>{reached();await decision;}),rejected=assert.rejects(execution,{message:'WORKFLOW_CANCELLED'});
  await atCheckpoint;controller.abort(Error('WORKFLOW_CANCELLED'));await rejected;approve();
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(f.mutations,0);
});

test('managed targets reject changed accessible meaning despite a surviving ID or CSS fallback',{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body='<button id="action" data-testid="action" onclick="fetch(\'/sandbox/mutation\')">Delete</button><output id="result">Ready</output>';
  for(const locators of [[{kind:'testId',value:'action'},{kind:'role',role:'button',name:'Search'}],[{kind:'role',role:'button',name:'Search'}]]){
    await assert.rejects(f.run([{op:'click',selector:'#action',locators}]),{message:'ELEMENT_CHANGED'});assert.equal(f.mutations,0);
  }
});

test('managed approval resolves its target afresh after the website changes',{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body='<button id="action" data-testid="action" onclick="fetch(\'/sandbox/mutation\')">Search</button><output id="result">Ready</output><script>setTimeout(()=>document.querySelector(\'#action\').textContent=\'Delete\',100)</script>';
  await assert.rejects(f.run(undefined,undefined,()=>new Promise(resolve=>setTimeout(resolve,250))),{message:'ELEMENT_CHANGED'});
  assert.equal(f.mutations,0);
});

test('semantic identity stays bound while Playwright waits for click actionability',{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body='<button id="action" data-testid="action" onclick="fetch(\'/sandbox/mutation\')">Search</button><output id="result">Ready</output><div id="cover" style="position:fixed;inset:0;background:white"></div><script>setTimeout(()=>document.querySelector(\'#action\').textContent=\'Delete\',250);setTimeout(()=>document.querySelector(\'#cover\').remove(),600)</script>';
  await assert.rejects(f.run([{op:'click',selector:'#action',locators:[{kind:'testId',value:'action'},{kind:'role',role:'button',name:'Search'}]}]),{message:'ELEMENT_CHANGED'});
  assert.equal(f.mutations,0);
});

test('native click retries still work when an overlay disappears without changing the target',{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body+='<div id="cover" style="position:fixed;inset:0;background:white"></div><script>setTimeout(()=>document.querySelector(\'#cover\').remove(),500)</script>';
  assert.equal((await f.run([{op:'click',selector:'#action',locators:[{kind:'testId',value:'action'},{kind:'role',role:'button',name:'Search'}]}])).result.result,'Done');
  assert.equal(f.mutations,1);
});

test('actionability retries reject an old element even if another control now matches its locator',{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body+='<div id="cover" style="position:fixed;inset:0;background:white"></div><script>setTimeout(()=>{const old=document.querySelector(\'#action\');old.removeAttribute(\'id\');old.removeAttribute(\'data-testid\');old.textContent=\'Delete\';const next=document.createElement(\'button\');next.id=\'action\';next.dataset.testid=\'action\';next.textContent=\'Search\';document.body.append(next)},250);setTimeout(()=>document.querySelector(\'#cover\').remove(),600)</script>';
  await assert.rejects(f.run([{op:'click',selector:'#action',locators:[{kind:'testId',value:'action'},{kind:'role',role:'button',name:'Search'}]}]),{message:'ELEMENT_CHANGED'});
  assert.equal(f.mutations,0);
});

test('disabled approval steps and legacy CSS actions run without an approver',{timeout:30000},async t=>{
  const f=await fixture(t);
  const result=await f.run([{op:'click',selector:'#action',approval_required:true,enabled:false},{op:'click',selector:'#action'}]);
  assert.equal(result.result.result,'Done');assert.equal(f.mutations,1);
});

for(const event of ['pointerover','pointerdown'])test(`native ${event} handlers cannot change Search to Delete and receive the later click`,{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body=`<button id="action" data-testid="action" on${event}="this.textContent='Delete'" onclick="fetch('/sandbox/mutation')">Search</button><output id="result">Ready</output>`;
  await assert.rejects(f.run([{op:'click',selector:'#action',locators:[{kind:'testId',value:'action'},{kind:'role',role:'button',name:'Search'}]}]),{message:'ELEMENT_CHANGED'});
  assert.equal(f.mutations,0);
});

test('successful native navigation verifies the new document after its old input guard is disposed',{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body='<a id="action" href="/sandbox/done">Search</a><output id="result">Ready</output>';
  assert.equal((await f.run([{op:'click',selector:'#action',locators:[{kind:'role',role:'link',name:'Search'}]}])).result.result,'Done');
  assert.equal(f.mutations,0);
});

test('a pointer-down replacement cannot redirect the remaining native click to another control',{timeout:30000},async t=>{
  const f=await fixture(t);
  f.body='<button id="action" onclick="fetch(\'/sandbox/mutation\')">Search</button><output id="result">Ready</output><script>document.querySelector(\'#action\').addEventListener(\'pointerdown\',()=>{const next=document.createElement(\'button\');next.id=\'action\';next.textContent=\'Delete\';next.onclick=()=>fetch(\'/sandbox/mutation\');document.querySelector(\'#action\').replaceWith(next)})</script>';
  await assert.rejects(f.run([{op:'click',selector:'#action',locators:[{kind:'role',role:'button',name:'Search'}]}]));
  assert.equal(f.mutations,0);
});
