import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflowWait,outputWaitMatches} from '../server/workflow-waits.mjs';
import {startRun,observeProgress} from '../server/run-state.mjs';
import {executionReceipt,assertObservationWindow} from '../server/execution-receipt.mjs';

const run=(step,extra={})=>runWorkflowWait(step,{deadline:Date.now()+2000,check:()=>{},observe:async()=>false,...extra});
test('waits observe conditions and typed output values without treating zero or false as empty',async()=>{
  assert.equal(await run({op:'wait_output',timeout_ms:500},{observe:async()=>true}),true);
  for(const value of [0,false,'0',{value:0},[false]])assert.equal(outputWaitMatches({predicate:'nonempty'},value),true);
  for(const value of [undefined,null,'','  ',[],{}])assert.equal(outputWaitMatches({predicate:'nonempty'},value),false);
  for(const value of [0,false,null,''])assert.equal(outputWaitMatches({predicate:'equals',value},value),true);
  assert.equal(outputWaitMatches({predicate:'equals',value:0},'0'),false);
});
test('only an explicitly continued step timeout skips the wait',async()=>{
  assert.equal(await run({op:'wait_delay',duration_ms:1000,timeout_ms:100,error_policy:'continue'}),false);
  await assert.rejects(run({op:'wait_delay',duration_ms:1000,timeout_ms:100}),{message:'TIMEOUT',phase:'step_wait'});
  for(const message of ['POLICY_BLOCKED','AUTH_REQUIRED','BROWSER_DISCONNECTED','VERIFICATION_FAILED'])await assert.rejects(run({op:'wait_output',timeout_ms:100,error_policy:'continue'},{observe:async()=>{throw Error(message);}}),{message});
  await assert.rejects(run({op:'wait_output',timeout_ms:100,error_policy:'continue'},{observe:async()=>{throw Error('TIMEOUT');}}),error=>error.message==='TIMEOUT'&&error.phase===undefined);
});
test('overall timeout, cancellation and stalled observers cannot bypass deadlines',async()=>{
  await assert.rejects(run({op:'wait_delay',duration_ms:1000,timeout_ms:1000,error_policy:'continue'},{deadline:Date.now()+75}),{message:'TIMEOUT'});
  const controller=new AbortController(),started=Date.now();
  const pending=run({op:'wait_output',timeout_ms:1000,error_policy:'continue'},{signal:controller.signal,observe:()=>new Promise(()=>{})});
  setTimeout(()=>controller.abort(Error('WORKFLOW_CANCELLED')),25);
  await assert.rejects(pending,{message:'WORKFLOW_CANCELLED'});assert.ok(Date.now()-started<500);
  assert.equal(await run({op:'wait_output',timeout_ms:100,error_policy:'continue'},{observe:()=>new Promise(()=>{})}),false);
});
test('bounded delay actually waits and disabled or continued steps do not claim condition success',async()=>{
  const before=Date.now();assert.equal(await run({op:'wait_delay',duration_ms:100,timeout_ms:1000}),true);assert.ok(Date.now()-before>=100);
  const definition={steps:[{op:'wait_delay',duration_ms:1000,error_policy:'continue'}]},payload={};
  startRun(payload,definition,new Date().toISOString());observeProgress(payload,definition,0,1);observeProgress(payload,definition,0,1,{phase:'skipped',warning:'WAIT_TIMEOUT_CONTINUED'});
  assert.equal(payload.steps[0].status,'skipped');assert.equal(payload.steps[0].warning,'WAIT_TIMEOUT_CONTINUED');
  const receipt=executionReceipt({id:'run_fixture',workflow_id:'wf_fixture',status:'running',created_at:payload.started_at},payload);
  assert.equal(receipt.step_outcomes[0].warning,'WAIT_TIMEOUT_CONTINUED');assert.equal(receipt.step_outcomes[0].status,'skipped');
  const start='2026-10-22T00:00:00.000Z',finish='2026-10-22T00:00:02.000Z',proof={observed_at:start,verified_at:finish};
  assert.throws(()=>assertObservationWindow({started_at:start,steps:[{status:'skipped',finished_at:finish,warning:'WAIT_TIMEOUT_CONTINUED'}]},proof,finish),/VERIFICATION_FAILED/,'Output evidence must follow continued waits as well as successful steps');
});
