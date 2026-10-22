import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestRank,workflowHealth} from '../server/workflow-health.mjs';

const from='2026-10-01T00:00:00.000Z',to='2026-10-08T00:00:00.000Z';
const options=()=>({workflow:{id:'wf_example',published_revision:2},runs:[],from,to,retentionDays:30,retainedFrom:'2026-09-08T00:00:00.000Z'});
const record=(id,status,extra={},row={})=>({row:{id:`run_${id}`,workflow_id:'wf_example',status,created_at:'2026-10-02T00:00:00.000Z',...row},payload:{phase:status,workflow_revision:1,execution_mode:'connected',started_at:'2026-10-02T00:00:01.000Z',finished_at:'2026-10-02T00:00:02.000Z',steps:[],...extra}});
const success=(id,duration,extra={})=>record(id,'succeeded',{
  outcome:'verified',workflow_version:'synthetic-v1',result:{value:'verified synthetic output'},...(duration===undefined?{}:{execution_ms:duration}),...extra,
  steps:(extra.steps??[]).map(step=>({...step,...step.status==='succeeded'?{started_at:'2026-10-02T00:00:01.000Z',finished_at:'2026-10-02T00:00:01.250Z'}:{}})),
  verification:{run_id:`run_${id}`,verifier_version:extra.workflow_version??'synthetic-v1',checks:['output_schema'],observed_at:'2026-10-02T00:00:01.500Z',verified_at:'2026-10-02T00:00:01.900Z',...extra.verification}
});

test('workflow health counts canonical states with verified success and explicit denominators',()=>{
  const report=workflowHealth({...options(),runs:[
    success('success',10),record('failure','failed',{error:{code:'ELEMENT_NOT_FOUND'}}),
    record('uncertain','failed',{outcome:'unknown',error:{code:'EXECUTION_OUTCOME_UNKNOWN'}}),
    record('cancelled','cancelled',{outcome:'unknown'}),
    record('timeout','failed',{error:{code:'WORKFLOW_TIMEOUT'}}),
    record('approval','running',{phase:'awaiting_approval'}),record('queued','queued'),
    record('legacy','succeeded',{execution_ms:20}),
    success('invalid_checks',30,{verification:{verified_at:'2026-10-02T00:00:02.000Z',checks:['<private>']}})
  ]});
  assert.deepEqual(report.counts,{invocations:9,completed:7,active:2,verified_success:1,failed:1,uncertain:3,cancelled:1,timed_out:1,approval_rejected:0,approval_expired:0});
  assert.equal(report.rates.verified_success_over_completed,1/7);
  assert.equal(report.rates.verified_success_over_invocations,1/9);
  assert.deepEqual(report.latency,{measurement:'execution_ms',unit:'milliseconds',samples:3,missing:4,median:20,p95:30,method:'nearest_rank'});
  assert.equal(report.last_successful_execution.execution_id,'run_success');
  assert.equal(report.last_verified_execution.execution_id,'run_success');
  assert.equal(report.retention.history_complete,true);
  assert.ok(report.warnings.some(item=>item.code==='SMALL_SAMPLE'));
});

test('health percentiles use nearest rank and exclude unavailable or invalid durations',()=>{
  assert.equal(nearestRank([],.5),null);
  assert.equal(nearestRank([null,undefined,NaN,Infinity,-1,'5'],.95),null);
  assert.equal(nearestRank([40,20,10,30],.5),20);
  assert.equal(nearestRank(Array.from({length:20},(_,index)=>index+1),.95),19);
  assert.equal(nearestRank([0],.5),0);
  for(const p of [0,1.1,-.1,NaN,'0.5'])assert.throws(()=>nearestRank([1],p),/INVALID_PERCENTILE/);
  const report=workflowHealth({...options(),runs:[success('one',undefined,{duration_ms:999,queue_duration_ms:20}),success('zero',0),success('negative',-1)]});
  assert.equal(report.latency.samples,1);assert.equal(report.latency.missing,2);assert.equal(report.latency.median,0);
});

test('health excludes historical success without correlated, ordered and complete proof',()=>{
  const valid=success('valid',1,{steps:[{number:1,status:'succeeded',duration_ms:1}]});
  const changes=[
    run=>{delete run.payload.verification.run_id;},
    run=>{run.payload.verification.run_id='run_unrelated';},
    run=>{delete run.payload.verification.verifier_version;},
    run=>{run.payload.verification.verifier_version='different-version';},
    run=>{delete run.payload.verification.observed_at;},
    run=>{run.payload.verification.observed_at='2026-10-02T00:00:00.500Z';},
    run=>{run.payload.verification.verified_at='2026-10-02T00:00:01.100Z';},
    run=>{run.payload.finished_at='2026-10-02T00:00:01.600Z';},
    run=>{run.payload.steps[0].status='running';},
    run=>{delete run.payload.steps[0].finished_at;},
    run=>{run.payload.steps[0].finished_at='2026-10-02T00:00:01.700Z';},
    run=>{delete run.payload.result;}
  ];
  const invalid=changes.map((change,index)=>{
    const run=success(`historical_${index}`,2,{steps:[{number:1,status:'succeeded',duration_ms:1}]});change(run);return run;
  });
  const report=workflowHealth({...options(),runs:[valid,...invalid]});
  assert.equal(report.counts.verified_success,1);assert.equal(report.counts.uncertain,changes.length);
  assert.equal(report.last_verified_execution.execution_id,'run_valid');
});

test('health period is half open, filters workflow scope and discloses retained history',()=>{
  const run=success('included',10);run.row.created_at=from;
  const outside=success('outside',10);outside.row.created_at=to;
  const foreign=success('foreign',10);foreign.row.workflow_id='wf_other';
  const invalid=success('bad_timestamp',10);invalid.row.created_at='broken';
  const report=workflowHealth({...options(),runs:[run,outside,foreign,invalid]});
  assert.equal(report.counts.invocations,1);assert.equal(report.trend[0].day,'2026-10-01');
  const partial=workflowHealth({...options(),retainedFrom:'2026-10-03T00:00:00Z',runs:[run,success('pruned',5)]});
  assert.equal(partial.counts.invocations,0);assert.equal(partial.retention.history_complete,false);
  assert.ok(partial.warnings.some(item=>item.code==='RETAINED_HISTORY_ONLY'));
  const unknown=workflowHealth({...options(),retainedFrom:null});assert.equal(unknown.retention.history_complete,false);
  for(const patch of [{from:'invalid'},{to:from},{to:'2028-01-01T00:00:00Z'},{retentionDays:0},{retainedFrom:'bad'}])assert.throws(()=>workflowHealth({...options(),...patch}),/INVALID_/);
});

test('health reports approval decisions once per run and attributes versions, steps and failures',()=>{
  const runs=[
    record('locator','failed',{error:{code:'ELEMENT_NOT_FOUND',step:2},steps:[{number:1,status:'succeeded',duration_ms:5},{number:2,status:'failed',duration_ms:25}]}),
    record('browser','failed',{workflow_revision:2,error:{cause_code:'AUTH_REQUIRED',code:'AUTHENTICATION_REQUIRED'},steps:[{number:1,status:'failed',duration_ms:40}]}),
    record('reject','failed',{workflow_revision:2,error:{cause_code:'APPROVAL_REJECTED'},approval:{id:'one',status:'rejected'},approval_history:[{id:'one',status:'rejected'}]}),
    record('expire','failed',{workflow_revision:2,error:{code:'WORKFLOW_TIMEOUT',detail_code:'APPROVAL_EXPIRED'},approval:{status:'expired'},approval_history:[{status:'expired'}]}),
    success('latest',8,{workflow_revision:2,finished_at:'2026-10-03T00:00:02Z',verification:{verified_at:'2026-10-03T00:00:01Z',checks:['schema']},steps:[{number:1,status:'succeeded',duration_ms:8}]}),
    success('draft',3,{workflow_revision:null})
  ];
  const report=workflowHealth({...options(),runs,revisions:[{revision:1,created_at:'2026-09-01T00:00:00Z'},{revision:2,created_at:'2026-10-02T12:00:00Z',execution_mode:'isolated',payload:'private'},{workflow_id:'wf_other',revision:3,created_at:from}]});
  assert.equal(report.counts.approval_rejected,1);assert.equal(report.counts.approval_expired,1);
  assert.equal(report.locator_failure_count,1);assert.equal(report.browser_session_failure_count,1);
  assert.equal(report.steps.find(step=>step.revision===1&&step.step===2).locator_failures,1);
  assert.equal(report.slowest_steps[0].duration.median,25);
  assert.equal(report.steps.find(step=>step.revision===2&&step.step===1).duration.p95,40);
  assert.deepEqual(report.versions.map(version=>version.revision),[null,1,2]);
  assert.equal(report.versions.find(version=>version.revision===2).counts.invocations,4);
  assert.equal(report.last_verified_execution.execution_id,'run_latest');
  assert.deepEqual(report.version_changes,[{revision:2,published_at:'2026-10-02T12:00:00.000Z',execution_mode:'isolated'}]);
  assert.deepEqual(report.recommendations.map(item=>item.code),['REVIEW_LOCATORS','REVIEW_BROWSER_SESSION','REVIEW_APPROVAL_TIMING','REVIEW_WAITS']);
});

test('health excludes raw data and arbitrary report labels, is deterministic and does not mutate inputs',()=>{
  const privateText='DO_NOT_EXPORT_PRIVATE_VALUE';
  const data={...options(),workflow:{id:'wf_example',name:privateText,description:privateText,active_revision:2},runs:[
    record('secret','failed',{workflow_version:privateText,input:{password:privateText},result:{content:privateText},error:{code:privateText,message:privateText,selector:privateText,verification:{reason:privateText}},steps:[{number:1,status:'failed',duration_ms:4,locator:privateText,label:privateText}],approval:{context:{target:{name:privateText}}}})
  ],revisions:[{revision:1,created_at:from,definition:{password:privateText},name:privateText}]};
  const before=JSON.stringify(data),first=workflowHealth(data),second=workflowHealth(data);
  assert.deepEqual(first,second);assert.equal(JSON.stringify(data),before);
  assert.equal(JSON.stringify(first).includes(privateText),false);
  assert.deepEqual(first.failure_breakdown,[{cause:'OTHER',count:1}]);
  const empty=workflowHealth(options());assert.equal(empty.rates.verified_success_over_completed,null);assert.equal(empty.latency.median,null);assert.equal(empty.last_verified_execution,null);
  assert.equal(empty.trend.length,7);assert.ok(empty.trend.every(item=>item.invocations===0));
  const enough=workflowHealth({...options(),runs:Array.from({length:20},(_,i)=>success(i,i))});assert.equal(enough.warnings.some(item=>item.code==='SMALL_SAMPLE'),false);
  assert.throws(()=>workflowHealth({...options(),runs:[success('same',1),success('same',2)]}),/INVALID_HEALTH_RUN/);
});
