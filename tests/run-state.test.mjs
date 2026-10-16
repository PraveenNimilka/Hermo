import test from 'node:test';
import assert from 'node:assert/strict';
import {startRun,observeProgress,finishRun,runError,recoverInterruptedRuns} from '../server/run-state.mjs';
import {openStore,hash} from '../server/store.mjs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';

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
  finishRun(payload,'succeeded',accepted,undefined,'2026-10-15T00:00:04.000Z');
  assert.equal(payload.queue_duration_ms,2000);assert.equal(payload.execution_ms,2000);assert.equal(payload.duration_ms,4000);
  assert.equal(payload.current_step.number,2);assert.equal(payload.outcome,'verified');assert.equal(payload.progress,100);
});

test('timeouts, cancellation, tab loss and restart retain unknown external outcomes',()=>{
  for(const reason of ['TIMEOUT','WORKFLOW_CANCELLED','TAB_CLOSED','BROWSER_DISCONNECTED','ACTION_PAUSED','INTERRUPTED']){
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

test('restart recovers each interrupted run without discarding provenance or replaying mutations',()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const store=openStore(resolve('work/run-state-tests',randomBytes(6).toString('hex'))),{db,seal,unseal}=store;
  try{
    const at=new Date(Date.now()-5000).toISOString();
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn','Fixture','https://example.test/','connected',seal({}),at);
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf','conn','Fixture','fixture.test','published','v-pinned',seal({}),null,at);
    for(const [rid,status,submitted]of [['run_action','running',true],['run_read','verifying',false],['run_queue','queued',false]]){
      const payload={input:{query:'saved value'},workflow_version:'v-pinned',started_at:at,progress:67,submission_may_have_occurred:submitted,current_step:{number:2,total:3,operation:'click'},steps:[{number:2,operation:'click',status:'running',started_at:at}],result:{not_verified:'discard'}};
      db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(rid,'wf','studio',rid,hash(rid),status,seal(payload),at,at);
    }
    recoverInterruptedRuns(store);
    const row=db.prepare('SELECT * FROM runs WHERE id=?').get('run_action'),payload=unseal(row.payload);
    assert.equal(row.status,'failed');assert.equal(payload.workflow_version,'v-pinned');assert.equal(payload.input.query,'saved value');
    assert.equal(payload.progress,67);assert.equal(payload.steps[0].status,'failed');assert.equal(payload.result,undefined);
    assert.equal(payload.error.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(payload.error.cause_code,'INTERRUPTED');assert.equal(payload.error.requires_human,true);
    assert.equal(unseal(db.prepare('SELECT payload FROM runs WHERE id=?').get('run_read').payload).error.code,'INTERRUPTED');
    assert.equal(db.prepare('SELECT status FROM runs WHERE id=?').get('run_queue').status,'queued');
    assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE event='run.interrupted'").get().n,2);
    recoverInterruptedRuns(store);assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE event='run.interrupted'").get().n,2);
  }finally{store.close();}
});
