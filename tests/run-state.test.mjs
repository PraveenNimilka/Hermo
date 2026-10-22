import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRun,startRun,observeProgress,finishRun,runError,recoverInterruptedRuns,transitionRun,persistRun} from '../server/run-state.mjs';
import {openStore,hash} from '../server/store.mjs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';

test('preparation retains queue timing and canonical terminal phases cannot be rewritten',()=>{
  const at='2026-10-22T00:00:00.000Z',ready='2026-10-22T00:00:01.000Z',payload={phase:'queued'};
  prepareRun(payload,at,ready);assert.equal(payload.phase,'preparing');assert.equal(payload.queue_duration_ms,1000);
  startRun(payload,{steps:[]},at,'2026-10-22T00:00:02.000Z');assert.equal(payload.started_at,ready);assert.equal(payload.queue_duration_ms,1000);
  finishRun(payload,'failed',at,runError(Error('TIMEOUT')));assert.equal(payload.phase,'timed_out');const finished=structuredClone(payload);
  startRun(payload,{steps:[]},at);finishRun(payload,'failed',at,runError(Error('INTERRUPTED')));assert.deepEqual(payload,finished);
});

test('step history contains timing and parameter names without selectors or values',()=>{
  const definition={effect:'recorded_browser_actions',steps:[{op:'fill',parameter:'query',selector:'[data-token="NEVER_LOG"]'},{op:'click',selector:'#private-button'}]};
  const payload={input:{query:'private customer data'},workflow_version:'pinned'};
  const accepted='2026-10-15T00:00:00.000Z';
  startRun(payload,definition,accepted,'2026-10-15T00:00:02.000Z');
  observeProgress(payload,definition,0,2,{},'2026-10-15T00:00:02.100Z');
  observeProgress(payload,definition,0,2,{phase:'issuing'});
  observeProgress(payload,definition,0,2,{phase:'completed'},'2026-10-15T00:00:03.000Z');
  observeProgress(payload,definition,1,2,{},'2026-10-15T00:00:03.000Z');
  observeProgress(payload,definition,1,2,{phase:'completed'},'2026-10-15T00:00:03.100Z');
  observeProgress(payload,definition,2,2,{phase:'verifying'},'2026-10-15T00:00:03.100Z');
  assert.equal(payload.phase,'verifying');assert.equal(payload.steps[0].duration_ms,900);
  assert.equal(payload.submission_may_have_occurred,true);
  assert.equal(/NEVER_LOG|private-button|private customer/.test(JSON.stringify(payload.steps)),false);
  payload.verification={checks:['nonempty_outputs'],verified_at:'2026-10-15T00:00:04.000Z'};
  finishRun(payload,'succeeded',accepted,undefined,'2026-10-15T00:00:04.000Z');
  assert.equal(payload.queue_duration_ms,2000);assert.equal(payload.execution_ms,2000);assert.equal(payload.duration_ms,4000);
  assert.equal(payload.current_step.number,2);assert.equal(payload.outcome,'verified');assert.equal(payload.progress,100);
});

test('stable step identities follow the pinned order without replacing public step numbers',()=>{
  const definition={steps:[{id:'step_second_action',op:'click'},{id:'step_first_action',op:'fill',parameter:'query'}]},payload={workflow_version:'pinned'};
  startRun(payload,definition,'2026-10-22T00:00:00Z','2026-10-22T00:00:01Z');
  assert.deepEqual(payload.steps.map(step=>[step.number,step.step_id]),[[1,'step_second_action'],[2,'step_first_action']]);
  observeProgress(payload,definition,0,2);assert.equal(payload.current_step.step_id,'step_second_action');assert.equal(payload.current_step.number,1);
});

test('timeouts, cancellation, tab loss and restart retain unknown external outcomes',()=>{
  for(const reason of ['TIMEOUT','WORKFLOW_CANCELLED','TAB_CLOSED','BROWSER_DISCONNECTED','ACTION_PAUSED','APPROVAL_REQUIRED','APPROVAL_REJECTED','INTERRUPTED']){
    const failure=runError(Error(reason),{submission_may_have_occurred:true,current_step:{number:2,total:3,operation:'click'}});
    assert.equal(failure.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(failure.cause_code,reason);
    assert.equal(failure.outcome,'unknown');assert.equal(failure.retry_safe,false);assert.match(failure.message,/inspect the website before retrying/);
  }
  assert.equal(runError(Error('TIMEOUT')).code,'WORKFLOW_TIMEOUT');
  assert.equal(runError(Error('TAB_CLOSED')).category,'TAB_UNAVAILABLE');
  const failure=runError(Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:'price',reason:'missing_output',value:'secret'}}));
  assert.equal(failure.code,'VERIFICATION_FAILED');assert.equal(failure.category,'OUTPUT_VALIDATION_FAILED');
  assert.equal(JSON.stringify(failure).includes('secret'),false);
  for(const reason of ['missing_output','not_fresh','still_streaming','not_settled']){
    const pending=Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:'result',reason,value:'private output'}});
    const uncertain=runError(pending,{submission_may_have_occurred:true});
    assert.equal(uncertain.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(uncertain.retry_safe,false);
    assert.equal(uncertain.cause_code,'VERIFICATION_FAILED');assert.equal(JSON.stringify(uncertain).includes('private output'),false);
    assert.equal(runError(pending).code,'VERIFICATION_FAILED','read-only verification remains an explicit failure');
  }
  assert.equal(JSON.stringify(runError(Error('a private browser exception containing a token'))).includes('token'),false);
  const observed={phase:'verifying',current_step:{number:1,total:1,operation:'click'},steps:[{number:1,operation:'click',status:'succeeded'}]};
  assert.equal(runError(Error('VERIFICATION_FAILED'),observed).step,undefined,'output verification must not label a successful click as the failed step');
  observed.steps[0].status='running';assert.equal(runError(Error('ACTION_UNAVAILABLE'),observed).step,1);
});

test('terminal observations resolve pending owner approval without implying its action ran',()=>{
  const accepted='2026-10-20T00:00:00.000Z',finished='2026-10-20T00:00:05.000Z';
  for(const [reason,status,approvalStatus]of [['APPROVAL_REJECTED','failed','rejected'],['TIMEOUT','failed','expired'],['WORKFLOW_TIMEOUT','failed','expired'],['WORKFLOW_CANCELLED','cancelled','cancelled'],['ACTION_PAUSED','failed','cancelled'],['INTERRUPTED','failed','cancelled']]){
    const payload={phase:'awaiting_approval',approval:{id:'approval_synthetic',step:2,status:'pending',requested_at:accepted},steps:[{number:1,operation:'wait_text',status:'succeeded'},{number:2,operation:'click',status:'awaiting_approval',started_at:accepted},{number:3,operation:'click',status:'pending'}]};
    const error=runError(Error(reason),payload);assert.equal(error.step,2);
    finishRun(payload,status,accepted,error,finished);
    assert.equal(payload.approval.status,approvalStatus);assert.equal(payload.approval.decided_at,finished);
    assert.equal(payload.steps[1].status,status==='cancelled'?'cancelled':'failed');assert.equal(payload.steps[2].status,'skipped');
    assert.equal(payload.error.retry_safe,true);assert.equal(payload.outcome,'unverified');
  }
  const approved={phase:'verifying',verification:{checks:['source'],verified_at:finished},approval:{id:'approval_synthetic',status:'approved',decided_at:accepted},steps:[]};
  finishRun(approved,'succeeded',accepted,undefined,finished);assert.equal(approved.approval.status,'approved');assert.equal(approved.approval.decided_at,accepted);
});

test('lifecycle rejects backward motion and completed action reissue while terminal observations are immutable',()=>{
  const definition={steps:[{op:'click'}]},at='2026-10-20T00:00:00.000Z',payload={};
  startRun(payload,definition,at,at);observeProgress(payload,definition,0,1,{},at);
  observeProgress(payload,definition,0,1,{},'2026-10-20T00:00:01.000Z');assert.equal(payload.steps[0].started_at,at);
  observeProgress(payload,definition,0,1,{phase:'issuing'});observeProgress(payload,definition,0,1,{phase:'issuing'});
  observeProgress(payload,definition,0,1,{phase:'completed'});
  const completed=JSON.stringify(payload);observeProgress(payload,definition,0,1,{phase:'completed'});assert.equal(JSON.stringify(payload),completed);
  assert.throws(()=>observeProgress(payload,definition,0,1,{phase:'issuing'}),/INVALID_RUN_TRANSITION/);
  assert.throws(()=>observeProgress(payload,definition,0,1,{}),/INVALID_RUN_TRANSITION/);
  observeProgress(payload,definition,1,1,{phase:'verifying'});
  assert.throws(()=>transitionRun(payload,'running'),/INVALID_RUN_TRANSITION/);
  payload.verification={checks:['source'],verified_at:at};finishRun(payload,'succeeded',at);
  const finished=JSON.stringify(payload);observeProgress(payload,definition,0,1,{phase:'issuing'});startRun(payload,definition,at);finishRun(payload,'failed',at,runError(Error('TIMEOUT')));assert.equal(JSON.stringify(payload),finished);
});

test('success requires completed steps and timestamped safe verification evidence',()=>{
  const at='2026-10-20T00:00:00.000Z';
  for(const payload of [{phase:'running',steps:[],verification:{checks:['source'],verified_at:at}},{phase:'verifying',steps:[{status:'pending'}],verification:{checks:['source'],verified_at:at}},{phase:'verifying',steps:[]},{phase:'verifying',steps:[],verification:{checks:[],verified_at:at}},{phase:'verifying',steps:[],verification:{checks:['source'],verified_at:'invalid'}},{phase:'verifying',steps:[],verification:{checks:['secret\nprivate'],verified_at:at}}]){
    const before=JSON.stringify(payload);assert.throws(()=>finishRun(payload,'succeeded',at),/VERIFICATION_FAILED/);assert.equal(JSON.stringify(payload),before);
  }
  const payload={phase:'verifying',steps:[],verification:{checks:['source'],verified_at:at,verifier_version:'old'}};
  assert.throws(()=>finishRun(payload,'succeeded',at,undefined,at,{verifierVersion:'new'}),/VERIFICATION_FAILED/);
  const ordered={},definition={steps:[{op:'click'},{op:'click'}]};startRun(ordered,definition,at,at);
  assert.throws(()=>observeProgress(ordered,definition,1,2),/INVALID_RUN_TRANSITION/);
  assert.throws(()=>observeProgress(ordered,definition,2,2,{phase:'verifying'}),/INVALID_RUN_TRANSITION/);
});

test('verification diagnostics retain safe paths and keywords without values or arbitrary messages',()=>{
  const payload={phase:'awaiting_approval'};
  assert.equal(runError(Error('TIMEOUT'),payload).detail_code,'APPROVAL_EXPIRED');
  for(const [reason,detail]of [['below_minimum','OUTPUT_SCHEMA_INVALID'],['duplicate_value','OUTPUT_VERIFICATION_FAILED'],['completion_unverified','OUTPUT_STALE']]){
    const error=runError(Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:'rows',reason,path:['rows',2,'amount'],keyword:'minimum',value:'private'}}));
    assert.deepEqual(error.verification,{output:'rows',reason,path:['rows',2,'amount'],keyword:'minimum'});assert.equal(error.detail_code,detail);assert.equal(JSON.stringify(error).includes('private'),false);
  }
  const unsafe=runError(Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:'rows',reason:'invalid_structure',path:['rows','[password=secret]'],keyword:'private'}}));
  assert.deepEqual(unsafe.verification,{output:'rows',reason:'invalid_structure'});
});

test('restart recovers each interrupted run without discarding provenance or replaying mutations',()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const store=openStore(resolve('work/run-state-tests',randomBytes(6).toString('hex'))),{db,seal,unseal}=store;
  try{
    const at=new Date(Date.now()-5000).toISOString();
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn','Fixture','https://example.test/','connected',seal({}),at);
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf','conn','Fixture','fixture.test','published','v-pinned',seal({}),null,at);
    for(const [rid,status,submitted]of [['run_action','running',true],['run_read','verifying',false],['run_wait','running',false],['run_queue','queued',false]]){
      const payload={input:{query:'saved value'},workflow_version:'v-pinned',started_at:at,progress:67,submission_may_have_occurred:submitted,current_step:{number:2,total:3,operation:'click'},steps:[{number:2,operation:'click',status:'running',started_at:at}],result:{not_verified:'discard'}};
      if(rid==='run_wait'){payload.phase='awaiting_approval';payload.approval={id:'synthetic-one-use-approval',step:2,status:'pending'};payload.steps[0].status='awaiting_approval';}
      db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(rid,'wf','studio',rid,hash(rid),status,seal(payload),at,at);
    }
    recoverInterruptedRuns(store);
    const row=db.prepare('SELECT * FROM runs WHERE id=?').get('run_action'),payload=unseal(row.payload);
    assert.equal(row.status,'failed');assert.equal(payload.workflow_version,'v-pinned');assert.equal(payload.input.query,'saved value');
    assert.equal(payload.progress,67);assert.equal(payload.steps[0].status,'failed');assert.equal(payload.result,undefined);
    assert.equal(payload.error.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(payload.error.cause_code,'INTERRUPTED');assert.equal(payload.error.requires_human,true);
    assert.equal(unseal(db.prepare('SELECT payload FROM runs WHERE id=?').get('run_read').payload).error.code,'INTERRUPTED');
    const waiting=unseal(db.prepare('SELECT payload FROM runs WHERE id=?').get('run_wait').payload);
    assert.equal(db.prepare('SELECT status FROM runs WHERE id=?').get('run_wait').status,'failed');assert.equal(waiting.approval.status,'cancelled');assert.equal(waiting.error.cause_code,'INTERRUPTED');assert.equal(waiting.result,undefined);
    assert.equal(db.prepare('SELECT status FROM runs WHERE id=?').get('run_queue').status,'queued');
    assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE event='run.interrupted'").get().n,3);
    recoverInterruptedRuns(store);assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE event='run.interrupted'").get().n,3);
  }finally{store.close();}
});
