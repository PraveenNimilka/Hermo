import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {openStore,hash} from '../server/store.mjs';
import {startRun,observeProgress,finishRun,runError,persistRun} from '../server/run-state.mjs';
import {createRunApprovals,approvalWebsiteOrigin} from '../server/run-approvals.mjs';

test('approval website follows the recorded navigation scope instead of the connection start page',()=>{
  const connection={url:'https://first.example/start',checkpoint:'https://first.example/checkpoint?private=value'};
  const definition={steps:[{op:'wait_element'},{op:'navigate',url:'https://second.example/private?token=redacted'},{op:'click'},{op:'navigate',url:'https://disabled.example',enabled:false}]};
  assert.equal(approvalWebsiteOrigin(connection,definition,0),'https://first.example');
  assert.equal(approvalWebsiteOrigin(connection,definition,1),'https://second.example');
  assert.equal(approvalWebsiteOrigin(connection,definition,2),'https://second.example');
  assert.equal(approvalWebsiteOrigin(connection,definition,3),'https://second.example');
  assert.equal(approvalWebsiteOrigin(connection,{steps:[{op:'navigate',template:'https://second.example/{record}'}]},0),'https://second.example');
});

function fixture(t){
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const store=openStore(resolve('work/run-approval-tests',randomBytes(6).toString('hex'))),{db,seal,unseal}=store,at=new Date().toISOString();
  t.after(()=>store.close());
  db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn','Fixture','https://example.test/','connected',seal({}),at);
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf','conn','Fixture','fixture.test','published','version',seal({}),null,at);
  const definition={steps:[{op:'click'},{op:'click'}]},payload={workflow_version:'version',workflow_revision:2};
  startRun(payload,definition,at,at);
  db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run','wf','studio','idem',hash('idem'),'running',seal(payload),at,at);
  const controller=new AbortController(),approvals=createRunApprovals({store,fail:(code)=>{throw Error(code);}});
  const read=()=>{const row=db.prepare('SELECT * FROM runs WHERE id=?').get('run');return {...row,value:unseal(row.payload)};};
  const wait=(index,change={})=>{observeProgress(payload,definition,index,2);return approvals.wait({id:'run',payload,index,operation:'click',signal:controller.signal,expiresAt:Date.now()+30000,authorize:()=>{},...change});};
  return {store,payload,definition,controller,approvals,read,wait,at};
}

test('multiple owner checkpoints retain frozen safe context and one-use decisions',async t=>{
  const f=fixture(t),context={workflow_id:'wf',workflow_name:'Fixture',workflow_version:'version',website_origin:'https://example.test/task?token=private',execution_mode:'connected_chrome',operation:'click',target:{role:'button',name:'Submit',framed:false,selector:'#private'},risk:'website_action',proposed_value_redacted:true,input:{secret:'private'},selector:'#private'};
  let waiting=f.wait(0,{context});context.target.name='Changed later';
  let current=f.read().value;assert.equal(current.approval.context.target.name,'Submit');assert.equal(current.approval.context.website_origin,'https://example.test');assert.equal(JSON.stringify(current.approval).includes('private'),false);
  const first=current.approval.id;f.approvals.decide('run',{approval_id:first,decision:'approve'});await waiting;
  assert.throws(()=>f.approvals.decide('run',{approval_id:first,decision:'approve'}),/APPROVAL_UNAVAILABLE/);
  observeProgress(f.payload,f.definition,0,2,{phase:'completed'});
  waiting=f.wait(1);current=f.read().value;const second=current.approval.id;
  assert.equal(current.approval_history.length,2);assert.equal(current.approval_history[0].status,'approved');assert.equal(current.approval_history[0].actor,'workspace_owner');assert.ok(current.approval_history[0].wait_ms>=0);
  assert.throws(()=>f.approvals.decide('run',{approval_id:first,decision:'approve'}),/APPROVAL_UNAVAILABLE/);
  const rejected=assert.rejects(waiting,/APPROVAL_REJECTED/);f.approvals.decide('run',{approval_id:second,decision:'reject'});await rejected;
  assert.deepEqual(f.read().value.approval_history.map(item=>item.status),['approved','rejected']);
});

test('expiry and cancellation settle history while terminal CAS ignores stale writers',async t=>{
  const f=fixture(t),waiting=f.wait(0,{expiresAt:Date.now()+20});await assert.rejects(waiting,/TIMEOUT/);
  let current=f.read();assert.equal(current.value.approval.status,'expired');assert.equal(current.value.approval_history[0].status,'expired');assert.equal(current.value.approval.actor,'runtime');
  const error=runError(Error('TIMEOUT'),current.value);assert.equal(error.detail_code,'APPROVAL_EXPIRED');
  finishRun(current.value,'failed',f.at,error);assert.equal(persistRun(f.store,'run','failed',current.value,['running']),true);
  const finished=f.read();assert.equal(persistRun(f.store,'run','running',f.payload,['running','failed']),false);assert.equal(persistRun(f.store,'run','failed',current.value,['failed']),false);
  assert.deepEqual(f.read(),finished);
});

test('aborted pending approval does not overwrite cancellation and history remains bounded',async t=>{
  const f=fixture(t);f.payload.approval_history=Array.from({length:40},(_,index)=>({id:'old_'+index,status:'approved'}));
  const waiting=f.wait(0),rejected=assert.rejects(waiting,/WORKFLOW_CANCELLED/),current=f.read();assert.equal(current.value.approval_history.length,32);
  finishRun(current.value,'cancelled',f.at,runError(Error('WORKFLOW_CANCELLED'),current.value));persistRun(f.store,'run','cancelled',current.value,['running']);
  f.controller.abort(Error('WORKFLOW_CANCELLED'));await rejected;
  const terminal=f.read();assert.equal(terminal.status,'cancelled');assert.equal(terminal.value.approval.status,'cancelled');assert.equal(terminal.value.approval_history.at(-1).status,'cancelled');
  assert.equal(terminal.value.approval.actor,'runtime');assert.equal(terminal.value.steps[0].status,'cancelled');assert.equal(terminal.value.result,undefined);
});
