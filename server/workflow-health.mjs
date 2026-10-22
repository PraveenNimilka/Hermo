import {executionReceipt,executionStatuses} from './execution-receipt.mjs';

const terminal=new Set(['succeeded','failed','uncertain','cancelled','timed_out']);
const active=new Set(executionStatuses.filter(status=>!terminal.has(status)));
const day=86400000;
const limit=100000;
const causes=new Set(['BROWSER_INSTALLATION_REQUIRED','BROWSER_UNAVAILABLE','MANAGED_PROFILE_BUSY','BROWSER_BUSY','AUTH_REQUIRED','AUTHENTICATION_REQUIRED','ELEMENT_NOT_FOUND','ELEMENT_CHANGED','ELEMENT_AMBIGUOUS','ACTION_UNAVAILABLE','BROWSER_DISCONNECTED','TAB_CLOSED','TAB_UNAVAILABLE','CONNECTION_STOPPED','PERMISSION_REVOKED','POLICY_BLOCKED','REVISION_PERMISSION_CHANGED','TIMEOUT','WORKFLOW_TIMEOUT','WORKFLOW_CANCELLED','APPROVAL_REJECTED','APPROVAL_EXPIRED','INTERRUPTED','RUNTIME_RESTARTED','VERIFICATION_FAILED','OUTPUT_VALIDATION_FAILED','OUTPUT_STALE','OUTPUT_SCHEMA_INVALID','OUTPUT_VERIFICATION_FAILED','EXECUTION_FAILED','EXECUTION_OUTCOME_UNKNOWN','HISTORICAL_EVIDENCE_UNAVAILABLE']);
const locatorCauses=new Set(['ELEMENT_NOT_FOUND','ELEMENT_CHANGED','ELEMENT_AMBIGUOUS','ACTION_UNAVAILABLE']);
const browserCauses=new Set(['BROWSER_INSTALLATION_REQUIRED','BROWSER_UNAVAILABLE','MANAGED_PROFILE_BUSY','BROWSER_BUSY','AUTH_REQUIRED','AUTHENTICATION_REQUIRED','BROWSER_DISCONNECTED','TAB_CLOSED','TAB_UNAVAILABLE','CONNECTION_STOPPED','PERMISSION_REVOKED']);
const milliseconds=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const revision=value=>Number.isSafeInteger(value)&&value>0?value:null;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const mode=value=>({connected_chrome:'connected',managed_local:'isolated'}[value]??(['connected','isolated'].includes(value)?value:'unknown'));
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,160}$/.test(value)?value:null;
const emptyCounts=()=>({invocations:0,completed:0,active:0,verified_success:0,failed:0,uncertain:0,cancelled:0,timed_out:0,approval_rejected:0,approval_expired:0});

// Nearest rank: sorted[ceil(p * N) - 1], with p in (0, 1]. Invalid or
// unavailable measurements are excluded, never replaced by zero.
export function nearestRank(values,p){
  if(typeof p!=='number'||!Number.isFinite(p)||p<=0||p>1)throw Error('INVALID_PERCENTILE');
  const sorted=values.filter(value=>milliseconds(value)!==null).toSorted((a,b)=>a-b);
  return sorted.length?sorted[Math.ceil(p*sorted.length)-1]:null;
}

function latency(values,completed){
  return {measurement:'execution_ms',unit:'milliseconds',samples:values.length,missing:completed-values.length,median:nearestRank(values,.5),p95:nearestRank(values,.95),method:'nearest_rank'};
}
function rates(counts){return {verified_success_over_completed:counts.completed?counts.verified_success/counts.completed:null,verified_success_over_invocations:counts.invocations?counts.verified_success/counts.invocations:null};}
function bucket(map,key){if(!map.has(key))map.set(key,{key,count:0});return map.get(key);}
function ordered(map){return [...map.values()].sort((a,b)=>b.count-a.count||String(a.key).localeCompare(String(b.key)));}

/** Local, input-free report over an invocation cohort [from,to).
 * The caller supplies only rows it is authorized to read and unseals payloads.
 * Outcomes reflect the supplied snapshot, not historical state reconstructed at
 * `to`. Retention completeness is disclosed rather than invented.
 */
export function workflowHealth({workflow,runs,revisions=[],from,to,retentionDays,retainedFrom=null}){
  const start=stamp(from),end=stamp(to),retained=retainedFrom===null?null:stamp(retainedFrom);
  if(!start||!end||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>366*day)throw Error('INVALID_MEASUREMENT_PERIOD');
  if(!safeId(workflow?.id)||!Array.isArray(runs)||runs.length>limit||!Array.isArray(revisions)||revisions.length>10000)throw Error('INVALID_HEALTH_INPUT');
  if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>3650||retainedFrom!==null&&!retained)throw Error('INVALID_RETENTION');
  const counts=emptyCounts(),durations=[],seen=new Set(),failures=new Map(),steps=new Map(),versions=new Map(),days=new Map(),modes=new Set();
  for(let date=Math.floor(Date.parse(start)/day)*day;date<Date.parse(end);date+=day){
    const key=new Date(date).toISOString().slice(0,10);days.set(key,{day:key,...emptyCounts()});
  }
  let latestSuccess=null,latestVerified=null;
  for(const {row,payload} of runs){
    if(row?.workflow_id!==workflow.id)continue;
    const accepted=stamp(row.created_at);
    if(!accepted||accepted<start||accepted>=end||retained&&accepted<retained)continue;
    if(!safeId(row.id)||seen.has(row.id)||!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('INVALID_HEALTH_RUN');
    seen.add(row.id);
    const receipt=executionReceipt(row,payload);
    let status=receipt.status;
    if(!terminal.has(status)&&!active.has(status)||status==='succeeded'&&!receipt.verification.checks.length)status='uncertain';
    const complete=terminal.has(status),published=revision(payload.workflow_revision),versionKey=published??'unversioned';
    if(!versions.has(versionKey))versions.set(versionKey,{revision:published,counts:emptyCounts(),durations:[]});
    const version=versions.get(versionKey),date=accepted.slice(0,10);
    if(!days.has(date))days.set(date,{day:date,...emptyCounts()});
    const daily=days.get(date);
    const codes=[receipt.diagnostics.detail_code,receipt.diagnostics.cause_code,receipt.diagnostics.code].filter(value=>causes.has(value));
    const history=Array.isArray(payload.approval_history)?payload.approval_history:[];
    const approvalStatuses=[payload.approval?.status,...history.map(item=>item?.status)];
    const rejected=codes.includes('APPROVAL_REJECTED')||approvalStatuses.includes('rejected');
    const expired=codes.includes('APPROVAL_EXPIRED')||approvalStatuses.includes('expired');
    for(const target of [counts,version.counts,daily]){
      target.invocations++;target[complete?'completed':'active']++;
      if(complete)target[status==='succeeded'?'verified_success':status]++;
      if(rejected)target.approval_rejected++;
      if(expired)target.approval_expired++;
    }
    modes.add(mode(receipt.execution_mode));
    const duration=milliseconds(receipt.timing.execution_ms);
    if(complete&&duration!==null){durations.push(duration);version.durations.push(duration);}
    if(status==='succeeded'){
      const finished=stamp(receipt.timing.finished_at),verified=stamp(receipt.verification.verified_at);
      if(finished&&(!latestSuccess||finished>latestSuccess.at))latestSuccess={execution_id:row.id,at:finished,revision:published};
      if(verified&&(!latestVerified||verified>latestVerified.at))latestVerified={execution_id:row.id,at:verified,revision:published};
    }
    if(complete&&status!=='succeeded')bucket(failures,codes[0]??'OTHER').count++;
    const failedStepNumbers=new Set();
    for(const step of receipt.step_outcomes){
      if(!Number.isSafeInteger(step.number)||step.number<1||step.number>10000)continue;
      const key=`${versionKey}:${step.number}`;
      if(!steps.has(key))steps.set(key,{revision:published,step:step.number,observations:0,failures:0,locator_failures:0,durations:[]});
      const record=steps.get(key);record.observations++;
      if(step.status==='failed'){record.failures++;failedStepNumbers.add(step.number);}
      const time=milliseconds(step.duration_ms);
      if(['succeeded','failed','cancelled'].includes(step.status)&&time!==null)record.durations.push(time);
    }
    const errorStep=payload.error?.step;
    if(complete&&codes.some(code=>locatorCauses.has(code))&&Number.isSafeInteger(errorStep)&&errorStep>0&&errorStep<=10000){
      const record=steps.get(`${versionKey}:${errorStep}`);
      if(record&&failedStepNumbers.has(errorStep))record.locator_failures++;
    }
  }
  const stepStats=[...steps.values()].map(({durations:values,...step})=>({...step,duration:{samples:values.length,median:nearestRank(values,.5),p95:nearestRank(values,.95)}})).sort((a,b)=>(a.revision??0)-(b.revision??0)||a.step-b.step);
  const versionStats=[...versions.values()].map(({durations:values,...version})=>({...version,rates:rates(version.counts),latency:latency(values,version.counts.completed)})).sort((a,b)=>(a.revision??0)-(b.revision??0));
  const failureBreakdown=ordered(failures).map(({key,count})=>({cause:key,count}));
  // Only predefined classifications leave this module; website messages and
  // dynamic error-code strings must never become report labels.
  const locatorFailures=failureBreakdown.filter(item=>locatorCauses.has(item.cause)).reduce((sum,item)=>sum+item.count,0);
  const browserFailures=failureBreakdown.filter(item=>browserCauses.has(item.cause)).reduce((sum,item)=>sum+item.count,0);
  const recommendations=[];
  if(counts.uncertain)recommendations.push({code:'REVIEW_UNCERTAIN',message:'Inspect uncertain website outcomes before authorizing another attempt.'});
  if(locatorFailures)recommendations.push({code:'REVIEW_LOCATORS',message:'Review failed step locators and validate repairs in a draft before publishing.'});
  if(browserFailures)recommendations.push({code:'REVIEW_BROWSER_SESSION',message:'Check the authorized browser connection and sign-in session.'});
  if(counts.approval_expired)recommendations.push({code:'REVIEW_APPROVAL_TIMING',message:'Review approval availability and the bounded execution deadline.'});
  if(counts.timed_out)recommendations.push({code:'REVIEW_WAITS',message:'Review condition-based waits and observed execution times before changing timeouts.'});
  const warnings=[];
  if(counts.completed<20)warnings.push({code:'SMALL_SAMPLE',message:'Fewer than 20 completed runs are available. These measurements do not establish statistical reliability.'});
  if(!retained||retained>start)warnings.push({code:'RETAINED_HISTORY_ONLY',message:'The requested period may have missing history. Counts include only retained records supplied to this report.'});
  const revisionChanges=revisions.filter(item=>item.workflow_id===undefined||item.workflow_id===workflow.id).flatMap(item=>{
    const number=revision(item.revision),created=stamp(item.created_at);
    return number&&created&&created>=start&&created<end?[{revision:number,published_at:created,execution_mode:mode(item.execution_mode)}]:[];
  }).sort((a,b)=>a.published_at.localeCompare(b.published_at)||a.revision-b.revision);
  return {schema_version:'hermo.workflow-health.v1',workflow:{id:workflow.id,active_revision:revision(workflow.published_revision??workflow.active_revision)},
    period:{from:start,to:end,boundary:'[from,to)',cohort:'accepted_at',outcomes:'supplied_snapshot'},
    retention:{days:retentionDays,retained_from:retained,history_complete:retained!==null&&retained<=start},
    definitions:{completed:'Terminal runs: verified success, failed, uncertain, cancelled or timed out.',approval_counts:'Runs with at least one rejected or expired approval; these overlap terminal counts.',success_rate:'Verified success divided by completed invocations; active invocations excluded.',latency:'Recorded execution_ms for completed invocations, excluding queue time; missing measurements excluded.',trend:'UTC calendar days intersecting the accepted-at cohort, including days with no invocations.'},
    counts,rates:rates(counts),latency:latency(durations,counts.completed),execution_modes:[...modes].sort(),last_successful_execution:latestSuccess,last_verified_execution:latestVerified,
    failure_breakdown:failureBreakdown,locator_failure_count:locatorFailures,browser_session_failure_count:browserFailures,steps:stepStats,
    slowest_steps:stepStats.filter(step=>step.duration.median!==null).toSorted((a,b)=>b.duration.median-a.duration.median||(a.revision??0)-(b.revision??0)||a.step-b.step).slice(0,10),
    trend:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)),versions:versionStats,version_changes:revisionChanges,recommendations,warnings};
}
