import test from 'node:test';
import assert from 'node:assert/strict';
import {executionStatus,executionReceipt,assertObservationWindow} from '../server/execution-receipt.mjs';

const at='2026-10-22T00:00:00.000Z',after='2026-10-22T00:00:01.000Z',end='2026-10-22T00:00:02.000Z';
test('canonical states distinguish uncertainty, timeout, approval and explicit cancellation without changing legacy status',()=>{
  assert.equal(executionStatus({error:{outcome:'unknown'}},'failed'),'uncertain');
  assert.equal(executionStatus({error:{cause_code:'TIMEOUT'}},'failed'),'timed_out');
  assert.equal(executionStatus({error:{outcome:'unknown',cause_code:'TIMEOUT'}},'failed'),'uncertain');
  assert.equal(executionStatus({phase:'awaiting_approval'},'running'),'awaiting_approval');
  assert.equal(executionStatus({phase:'preparing'},'running'),'preparing');
  assert.equal(executionStatus({phase:'succeeded'},'running'),'running','an active row cannot claim a terminal outcome');
  assert.equal(executionStatus({phase:'running',error:{outcome:'unknown'}},'cancelled'),'cancelled');
});
test('receipts correlate verified output and omit request values and arbitrary diagnostics',()=>{
  const row={id:'run_receipt',workflow_id:'wf_fixture',status:'succeeded',created_at:at};
  const payload={input:{password:'NEVER_INCLUDE'},outcome:'verified',workflow_version:'hash',workflow_revision:2,execution_mode:'managed_local',started_at:at,finished_at:end,steps:[{number:1,status:'succeeded',selector:'PRIVATE_SELECTOR',finished_at:after}],result:{value:'Same answer'},verification:{run_id:row.id,verifier_version:'hash',observed_at:after,verified_at:end,checks:['output_schema']}};
  const receipt=executionReceipt(row,payload);
  assert.equal(receipt.execution_id,row.id);assert.deepEqual(receipt.output,payload.result);assert.equal(receipt.published_version.revision,2);assert.equal(receipt.status,'succeeded');
  assert.doesNotMatch(JSON.stringify(receipt),/NEVER_INCLUDE|PRIVATE_SELECTOR/);
  for(const changes of [{observed_at:undefined},{observed_at:at},{verifier_version:'another'},{run_id:'another'}]){
    const historical=executionReceipt(row,{...payload,verification:{...payload.verification,...changes}});
    assert.equal(historical.status,'uncertain');assert.equal(historical.verification.status,'unrecorded');assert.equal(historical.output,undefined);
  }
  assert.equal(executionReceipt(row,{...payload,steps:[{status:'pending'}]}).status,'uncertain');
  row.status='failed';payload.error={code:'EXECUTION_OUTCOME_UNKNOWN',cause_code:'TIMEOUT',message:'PRIVATE_SECRET',outcome:'unknown',retry_safe:false};
  const failed=executionReceipt(row,payload);assert.equal(failed.status,'uncertain');assert.equal(failed.output,undefined);assert.equal(failed.diagnostics.retry_safe,false);assert.doesNotMatch(JSON.stringify(failed),/PRIVATE_SECRET|Same answer/);
  assert.equal(executionReceipt({...row,status:'succeeded'},{result:{private:'not proven'}}).status,'uncertain');
});

test('receipts expose optional stable step IDs while rejecting arbitrary diagnostic identity strings',()=>{
  const row={id:'run_steps',workflow_id:'wf_steps',status:'running',created_at:at};
  const receipt=executionReceipt(row,{steps:[{number:1,step_id:'step_stable_action',status:'running'},{number:2,step_id:'PRIVATE_UNBOUNDED_VALUE',status:'pending'},{number:3,status:'pending'}]});
  assert.equal(receipt.step_outcomes[0].step_id,'step_stable_action');assert.equal(receipt.step_outcomes[1].step_id,undefined);assert.equal(receipt.step_outcomes[2].step_id,undefined);
  assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_UNBOUNDED_VALUE/);
});
test('runtime observation window rejects stale, missing, future and pre-step proof while accepting repeated equal results',()=>{
  const payload={started_at:at,steps:[{status:'succeeded',finished_at:after}]},proof={observed_at:after,verified_at:end};
  assert.doesNotThrow(()=>assertObservationWindow(payload,proof,end));
  for(const invalid of [{...proof,observed_at:at},{...proof,verified_at:at},{...proof,observed_at:'bad'},{...proof,verified_at:'2099-01-01T00:00:00Z'},{}])assert.throws(()=>assertObservationWindow(payload,invalid,end),/VERIFICATION_FAILED/);
  for(let i=0;i<2;i++)assert.doesNotThrow(()=>assertObservationWindow(payload,proof,end),'freshness does not require output inequality');
});
