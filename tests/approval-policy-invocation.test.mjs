import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';
import {openStore} from '../server/store.mjs';
import {createRunApprovals} from '../server/run-approvals.mjs';
import {startRun,finishRun,runError,persistRun,recoverInterruptedRuns} from '../server/run-state.mjs';
import {installApprovalInbox} from '../server/approval-inbox.mjs';
import {createApp} from '../server/index.mjs';
import {createServer} from 'node:net';

async function browserFixture(t){
  let visits=0;const server=http.createServer((req,res)=>{if(req.url==='/sandbox/read')visits++;res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Invocation approval fixture</title><output id="result">Read after approval</output>');});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port,proxy=await createEgressProxy(origin),engine=await createBrowserEngine(proxy,origin);
  t.after(async()=>{await engine.closeAll();await proxy.close();await new Promise(done=>server.close(done));});
  const connection={id:'invocation_fixture',url:origin+'/sandbox/read',origins:[origin],access:'public',identity:{kind:'public_origin',origin}};
  const definition={version:'invocation-fixture',approval_policy:{mode:'every_invocation'},inputs:{},steps:[],outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'nonempty',output:'result'}],timeout_ms:15000};
  return {get visits(){return visits;},execute:(steps=[],signal=new AbortController().signal,approve)=>engine.execute(connection,{...definition,steps},{},()=>{},signal,approve)};
}

test('output-only and disabled-only managed invocations cannot visit before approval',{timeout:30000},async t=>{
  const f=await browserFixture(t);
  for(const steps of [[],[{op:'navigate',url:'https://unvisited.example',enabled:false}]]){
    await assert.rejects(f.execute(steps),{message:'APPROVAL_REQUIRED'});assert.equal(f.visits,0);
    await assert.rejects(f.execute(steps,undefined,index=>{assert.equal(index,-1);throw Error('APPROVAL_REJECTED');}),{message:'APPROVAL_REJECTED'});assert.equal(f.visits,0);
  }
  let reached,approve;const checkpoint=new Promise(done=>reached=done),decision=new Promise(done=>approve=done),indices=[];
  const result=f.execute([],undefined,async index=>{indices.push(index);reached();await decision;});await checkpoint;assert.equal(f.visits,0);assert.deepEqual(indices,[-1]);approve();
  assert.deepEqual((await result).result,{result:'Read after approval'});assert.equal(f.visits,1);
});

test('cancelling an invocation approval prevents a late decision from visiting the website',{timeout:30000},async t=>{
  const f=await browserFixture(t),controller=new AbortController();let reached,approve;const checkpoint=new Promise(done=>reached=done),decision=new Promise(done=>approve=done);
  const result=f.execute([],controller.signal,async()=>{reached();await decision;}),rejected=assert.rejects(result,{message:'WORKFLOW_CANCELLED'});await checkpoint;controller.abort(Error('WORKFLOW_CANCELLED'));await rejected;approve();await new Promise(done=>setTimeout(done,50));assert.equal(f.visits,0);
});

async function approvalFixture(t){
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const directory=mkdtempSync(join(tmpdir(),'hermo-invocation-policy-')),store=openStore(directory),app=Fastify();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;
  t.after(async()=>{await app.close();store.close();rmSync(directory,{recursive:true,force:true});});const at=new Date().toISOString();
  store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn','Fixture','https://example.test/','connected',store.seal({}),at);
  store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf','conn','Output-only approval','invocation.approval','draft','version',store.seal({}),null,at);
  const definition={steps:[]},payload={workflow_version:'version'};startRun(payload,definition,at,at);
  store.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run','wf','studio','idem','hash','running',store.seal(payload),at,at);
  const controller=new AbortController(),fail=(code,message,status=400)=>{throw Object.assign(Error(message??code),{code,statusCode:status});},approvals=createRunApprovals({store,fail});installApprovalInbox(app,{store,fail});
  const wait=(options={})=>approvals.wait({id:'run',payload,index:-1,operation:'invocation',signal:controller.signal,expiresAt:Date.now()+30000,authorize:()=>{},...options});
  const read=()=>store.unseal(store.db.prepare('SELECT payload FROM runs WHERE id=?').get('run').payload);
  return {store,app,payload,controller,approvals,wait,read,at};
}

test('durable invocation approval stores scope without a synthetic step and is single-use',async t=>{
  const f=await approvalFixture(t),waiting=f.wait(),pending=f.read();assert.deepEqual(pending.steps,[]);assert.equal(pending.approval.scope,'invocation');assert.equal(pending.approval.step,0);assert.equal(pending.approval.operation,'invocation');assert.equal(pending.phase,'awaiting_approval');
  const page=(await f.app.inject('/studio/approvals')).json();assert.equal(page.items[0].approval.scope,'invocation');assert.equal(page.items[0].actionable,true);
  f.approvals.decide('run',{approval_id:pending.approval.id,decision:'approve'});await waiting;assert.equal(f.read().phase,'running');assert.deepEqual(f.read().steps,[]);
  assert.throws(()=>f.approvals.decide('run',{approval_id:pending.approval.id,decision:'approve'}),{message:'This approval expired or the run is no longer waiting.'});await assert.rejects(f.wait(),{message:'INVALID_RUN_TRANSITION'});
});

test('invocation expiry settles durable history without rewriting a terminal row',async t=>{
  const f=await approvalFixture(t);await assert.rejects(f.wait({expiresAt:Date.now()+10}),{message:'TIMEOUT'});assert.equal(f.read().approval.status,'expired');assert.equal(f.read().approval_history[0].status,'expired');
  const terminal=f.read();finishRun(terminal,'failed',f.at,runError(Error('TIMEOUT'),terminal));assert.equal(persistRun(f.store,'run','failed',terminal,['running']),true);assert.equal(persistRun(f.store,'run','running',f.payload,['running']),false);
});

test('cancelled invocation cannot resume after a late owner decision',async t=>{
  const f=await approvalFixture(t),waiting=f.wait(),rejected=assert.rejects(waiting,{message:'WORKFLOW_CANCELLED'}),pending=f.read(),id=pending.approval.id;
  finishRun(pending,'cancelled',f.at,runError(Error('WORKFLOW_CANCELLED'),pending));assert.equal(persistRun(f.store,'run','cancelled',pending,['running']),true);f.controller.abort(Error('WORKFLOW_CANCELLED'));await rejected;
  assert.equal(f.read().approval.status,'cancelled');assert.deepEqual(f.read().steps,[]);assert.throws(()=>f.approvals.decide('run',{approval_id:id,decision:'approve'}),error=>error.code==='APPROVAL_UNAVAILABLE');
});

test('interrupted invocation approval terminates safely during durable recovery',async t=>{
  const f=await approvalFixture(t),waiting=f.wait(),rejected=assert.rejects(waiting,{message:'WORKFLOW_CANCELLED'});recoverInterruptedRuns(f.store);
  const recovered=f.read();assert.equal(recovered.approval.status,'cancelled');assert.equal(recovered.approval_history[0].status,'cancelled');assert.deepEqual(recovered.steps,[]);assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get('run').status,'failed');
  f.controller.abort(Error('WORKFLOW_CANCELLED'));await rejected;assert.deepEqual(f.read(),recovered,'old approval waiter cannot overwrite recovered execution');
});

test('malformed invocation indices and inbox scope pairs fail closed',async t=>{
  const f=await approvalFixture(t);
  for(const options of [{index:-2},{index:-1,operation:'click'},{index:0,operation:'invocation'},{index:.5}])await assert.rejects(f.wait(options),{message:'INVALID_RUN_TRANSITION'});
  const base={id:randomUUID(),step:0,operation:'invocation',scope:'invocation',status:'pending',requested_at:new Date().toISOString(),expires_at:new Date(Date.now()+30000).toISOString()};
  for(const change of [{scope:undefined},{operation:'click'},{step:1},{step:-1},{step:1,operation:'click'}]){
    const payload={phase:'awaiting_approval',approval:{...base,...change}};f.store.db.prepare('UPDATE runs SET payload=? WHERE id=?').run(f.store.seal(payload),'run');const value=(await f.app.inject('/studio/approvals')).json();assert.deepEqual(value.items,[]);
  }
});

test('real admission and owner inbox gate output-only browser access for every invocation',{timeout:45000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=mkdtempSync(join(tmpdir(),'hermo-invocation-runtime-')),{app,store,origin}=await createApp({port,dataDir:directory});let cookie='',csrf='',visits=0;
  app.get('/sandbox/invocation-read',async(_,reply)=>{visits++;return reply.type('text/html').send('<!doctype html><title>Approved output-only read</title><output id="result">Approved read result</output>');});
  const call=async(path,body,headers={})=>{const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];return {status:response.statusCode,value:response.json()};};
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const observe=async(id,predicate)=>{for(let n=0;n<400;n++){const run=await ok('/studio/runs/'+id);if(predicate(run))return run;if(['succeeded','failed','cancelled'].includes(run.status))assert.fail(JSON.stringify(run));await new Promise(done=>setTimeout(done,25));}assert.fail('run did not reach expected state');};
  try{
    await app.listen({port,host:'127.0.0.1'});csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-invocation-owner-password'})).csrf;
    const at=new Date().toISOString(),connection={url:origin+'/sandbox/invocation-read',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}},definition={version:'output-only-invocation',approval_policy:{mode:'every_invocation'},inputs:{},steps:[],outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'nonempty',output:'result'}],timeout_ms:15000};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn','Output-only website',connection.url,'connected',store.seal(connection),at);store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf','conn','Output-only invocation','invocation.output','draft',definition.version,store.seal(definition),null,at);
    const start=async()=>observe((await ok('/studio/workflows/wf/test',{input:{}})).run_id,run=>run.phase==='awaiting_approval');
    const terminal=id=>observe(id,run=>['succeeded','failed','cancelled'].includes(run.status));
    let pending=await start();assert.equal(visits,0);assert.deepEqual(pending.steps,[]);assert.equal(pending.approval.step,0);assert.equal(pending.approval.scope,'invocation');
    const review=await ok('/studio/workflows/wf/permissions');assert.equal(review.approval_invocation_required,true);assert.deepEqual(review.approval_steps,[]);
    let inbox=await ok('/studio/approvals');assert.equal(inbox.items[0].approval.operation,'invocation');assert.equal(inbox.items[0].actionable,true);
    assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},{cookie:''})).status,401);
    await ok(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'reject'});assert.equal((await terminal(pending.id)).approval.status,'rejected');assert.equal(visits,0);
    pending=await start();assert.equal(visits,0);inbox=await ok('/studio/approvals');assert.equal(inbox.items[0].run_id,pending.id);
    await ok(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'});const completed=await terminal(pending.id);assert.equal(completed.status,'succeeded',JSON.stringify(completed.error));assert.deepEqual(completed.steps,[]);assert.deepEqual(completed.result,{result:'Approved read result'});assert.equal(visits,1);
    assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'})).status,409);assert.equal((await ok('/studio/approvals')).items.length,0);assert.equal((await ok('/studio/approvals?view=history')).items.length,2);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
