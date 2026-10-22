import {Check, Circle, Loader2, OctagonAlert} from 'lucide-react';
import {useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export type ExecutionObservation = {
  execution_status?:string;
  workflow_revision?:number|null;
  workflow_version?:string;
  execution_mode?:string;
  phase?:string;
  progress?:number;
  started_at?:string;
  finished_at?:string;
  queue_duration_ms?:number;
  execution_ms?:number;
  outcome?:string;
  id?:string;
  approval?:Approval;
  approval_history?:Approval[];
  verification_wait?:{output:string;state:string;checked_at:string};
  verification?:{status?:string;checks?:string[];verified_at?:string};
  verification_evidence?:{status:string;checked_at:string;failed_checks?:{output:string;reason:string;path?:(string|number)[]}[]};
  current_step?:{number:number;total:number;operation:string;step_id?:string};
  steps?:{number:number;operation:string;status:string;step_id?:string;warning?:string;input_name?:string;started_at?:string;finished_at?:string;duration_ms?:number}[];
  error?:{code:string;detail_code?:string;category?:string;cause_code?:string;message:string;outcome?:string;retry_safe?:boolean;step?:number;verification?:{output:string;reason:string;path?:(string|number)[];keyword?:string}};
};
type Approval={id:string;step:number;operation:string;scope?:'invocation';status:string;requested_at:string;expires_at:string;decided_at?:string;actor?:string;wait_ms?:number;context?:{workflow_id?:string;workflow_name?:string;workflow_version?:string;website_origin?:string;execution_mode?:string;input_name?:string;description?:string;risk?:string;proposed_value_redacted?:boolean;target?:{role?:string;name?:string;framed?:boolean}}};
const approvalLabel=(approval:Approval)=>approval.step===0&&approval.operation==='invocation'?'Invocation approval':`Step ${approval.step} · ${approval.operation.replaceAll('_',' ')}`;
const fieldPath=(path:(string|number)[])=>path.map((part,index)=>typeof part==='number'?`[${part}]`:(index?'.':'')+part).join('');

const words=(value:string)=>value.replaceAll('_',' ');
const duration=(value?:number)=>value===undefined?'—':value<1000?`${value} ms`:`${(value/1000).toFixed(1)} s`;
const verificationLabel=(value:string)=>({selected_tab_origin:'Selected website matched',public_source_origin:'Public website matched',nonempty_outputs:'Outputs contain data',output_schema:'Output types matched',fresh_generated_outputs:'New generated result captured'} as Record<string,string>)[value]??(value.endsWith('_url')?`${value.slice(0,-4)}: valid URL`:words(value));

export function ExecutionDetails({run,active=false,onDecision}:{run:ExecutionObservation;active?:boolean;onDecision?:(id:string,decision:'approve'|'reject')=>Promise<void>}) {
  const step=run.current_step;
  return <section className="execution-details" aria-label="Execution details">
    {(run.workflow_version||run.execution_mode)&&<dl className="execution-timing"><div><dt>Workflow version</dt><dd>{run.workflow_revision?`Revision ${run.workflow_revision}`:run.workflow_version?'Tested draft':'Historical run'}{run.workflow_version&&<code title={run.workflow_version}> · {run.workflow_version.slice(0,12)}</code>}</dd></div><div><dt>Execution mode</dt><dd>{run.execution_mode==='managed_local'?'Managed local browser':run.execution_mode==='connected_chrome'?'Connected Chrome':'Not recorded'}</dd></div></dl>}
    <p className="execution-phase" role={active?'status':undefined}>{run.phase==='awaiting_approval'?'Awaiting owner approval':run.phase==='verifying'?'Verifying captured outputs':active&&step?`Step ${step.number} of ${step.total} · ${words(step.operation)}`:active?'Waiting for the local runtime':run.outcome==='verified'?'Result verified':run.outcome==='unknown'?'Website outcome is unknown':'Execution finished'}</p>
    {active&&run.approval?.status==='pending'&&<OwnerApproval key={run.approval.id} approval={run.approval} onDecision={onDecision}/>}
    {!!run.steps?.length&&<ol className="execution-steps" aria-label="Step history">{run.steps.map(step=>{
      const Icon=step.status==='running'?Loader2:step.status==='succeeded'?Check:step.status==='failed'?OctagonAlert:Circle;
      return <li key={step.number} data-state={step.status}><span className="execution-step-number">{step.number}</span><Icon size={14} aria-hidden="true" className={step.status==='running'?'spin':undefined}/><div><strong>{words(step.operation)}</strong>{step.input_name&&<small>Input: <code>{step.input_name}</code></small>}{step.warning==='WAIT_TIMEOUT_CONTINUED'&&<small>Wait timed out · continued as configured</small>}</div><span className="execution-step-state">{words(step.status)}</span><time>{duration(step.duration_ms)}</time></li>;
    })}</ol>}
    {(run.queue_duration_ms!==undefined||run.execution_ms!==undefined)&&<dl className="execution-timing"><div><dt>Queue wait</dt><dd>{duration(run.queue_duration_ms)}</dd></div><div><dt>Execution</dt><dd>{duration(run.execution_ms)}</dd></div></dl>}
    {!!run.approval_history?.length&&<details className="advanced"><summary>Approval events ({run.approval_history.length})</summary><ol className="execution-steps" aria-label="Approval history">{run.approval_history.map(approval=><li key={approval.id}><div><strong>{approvalLabel(approval)}</strong><small>{words(approval.status)}{approval.actor?` · ${words(approval.actor)}`:''}</small></div><time>{duration(approval.wait_ms)}</time></li>)}</ol></details>}
    {run.phase==='verifying'&&run.verification_wait&&<p role="status">{run.verification_wait.output}: {({missing_output:'Waiting for the selected output to become readable. A visible image may use an unsupported address or a changed target.',loading:'The selected media is still loading or the website reports generation in progress.',waiting_for_new_result:'Waiting for a new result; the selected output still matches an earlier image.',settling:'New result detected; checking that it has finished changing.'} as Record<string,string>)[run.verification_wait.state]}</p>}
    {!!run.verification?.checks?.length&&<details className="execution-verification"><summary><span><Check size={15} aria-hidden="true"/>Verification checks</span><span>{run.verification.checks.length} passed</span></summary><ul>{run.verification.checks.map((check,index)=><li key={index}><Check size={14} aria-hidden="true"/><span title={check}>{verificationLabel(check)}</span></li>)}</ul></details>}
    {run.error?.detail_code&&<p className="small-text">Failure detail: <code>{run.error.detail_code}</code>{run.error.verification?.path&&<> · Field <code>{fieldPath(run.error.verification.path)}</code></>}</p>}
    {run.error&&<div className="execution-failure" role="alert"><strong>{run.error.outcome==='unknown'?'Inspect the website before retrying':'Execution needs attention'}</strong><p>{run.error.message}</p><dl><div><dt>Error code</dt><dd><code>{run.error.code}</code></dd></div>{run.error.cause_code&&run.error.cause_code!==run.error.code&&<div><dt>Cause</dt><dd><code>{run.error.cause_code}</code></dd></div>}{run.error.category&&run.error.category!==run.error.code&&<div><dt>Category</dt><dd><code>{run.error.category}</code></dd></div>}{run.error.verification&&<><div><dt>Output</dt><dd><code>{run.error.verification.output}</code></dd></div><div><dt>Observed</dt><dd>{words(run.error.verification.reason)}</dd></div></>}{run.error.step&&<div><dt>Failed step</dt><dd>{run.error.step}</dd></div>}</dl>{run.error.retry_safe===false&&<small>Cancellation and timeouts cannot undo a website submission. Hermo does not repeat uncertain actions.</small>}</div>}
    {run.id&&<p className="execution-run-id"><span>Run ID</span><code>{run.id}</code></p>}
  </section>;
}

function OwnerApproval({approval,onDecision}:{approval:NonNullable<ExecutionObservation['approval']>;onDecision?:(id:string,decision:'approve'|'reject')=>Promise<void>}){
  const invocation=approval.step===0&&approval.operation==='invocation';
  const[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function decide(decision:'approve'|'reject'){
    if(!onDecision||busy)return;setBusy(true);setError('');
    try{await onDecision(approval.id,decision);setConfirm(false);}catch(cause){setError(cause instanceof Error?cause.message:'The decision could not be saved.');}finally{setBusy(false);}
  }
  return <div className="run-approval" aria-label="Owner approval required"><strong>{approvalLabel(approval)}</strong><ApprovalContext approval={approval}/>{approval.context?.description&&<p>{approval.context.description}</p>}<p>{invocation?'Review the configured website and returned data before allowing this invocation to access the browser.':'Inspect the website and the workflow target before continuing. Earlier steps may already have changed data.'} Waiting ends by {new Date(approval.expires_at).toLocaleTimeString()} and holds the local execution queue.</p>{!onDecision?<p>Only the unlocked owner dashboard can approve this {invocation?'invocation':'step'}.</p>:<div className="resource-actions"><button className="button secondary" type="button" disabled={busy} onClick={()=>void decide('reject')}>{invocation?'Reject invocation':'Reject step'}</button><button className="button primary" type="button" disabled={busy} onClick={()=>setConfirm(true)}>Review approval</button></div>}{error&&<p role="alert">{error}</p>}
    <Dialog.Root open={confirm} onOpenChange={setConfirm}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content role="alertdialog" className="dialog-content"><div className="dialog-heading"><div><Dialog.Title>{invocation?'Approve this invocation?':`Approve step ${approval.step}?`}</Dialog.Title><Dialog.Description>{invocation?'This permits browser access and extraction for this run only. It does not authorize another invocation.':`This permits one ${words(approval.operation)} step in this run. Website actions can submit, delete or change data. Approval cannot undo earlier actions.`}</Dialog.Description></div></div><div className="dialog-body"><p>{invocation?'Confirm this workflow, website and returned-data scope match the invocation you intend to authorize.':'Confirm the current website and target match the recorded workflow. Hermo checks the live locator again after approval; a changed website can still change the meaning of a unique target.'}</p>{error&&<p role="alert">{error}</p>}<div className="dialog-footer"><Dialog.Close asChild><button className="button secondary" type="button" disabled={busy}>Keep waiting</button></Dialog.Close><button className="button primary" type="button" disabled={busy} onClick={()=>void decide('approve')}>{busy?'Saving decision…':invocation?'Approve this invocation':'Approve this step'}</button></div></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}

function ApprovalContext({approval}:{approval:Approval}){
  const context=approval.context;if(!context)return null;
  return <dl className="execution-timing approval-context"><div><dt>Workflow</dt><dd>{context.workflow_name}<small><code>{context.workflow_version?.slice(0,12)}</code></small></dd></div><div><dt>Website</dt><dd>{context.website_origin}</dd></div><div><dt>Recorded target</dt><dd>{[context.target?.role,context.target?.name].filter(Boolean).join(' · ')||'Review the recorded target on the website'}{context.target?.framed?' · within a frame':''}</dd></div><div><dt>Action scope</dt><dd>{words(context.risk??'website_action')}{context.input_name?` · input ${context.input_name}`:''}<small>Proposed values are redacted. Review the current website before approving.</small></dd></div></dl>;
}
