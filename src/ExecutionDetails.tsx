import {Check, Circle, Loader2, OctagonAlert} from 'lucide-react';

export type ExecutionObservation = {
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
  current_step?:{number:number;total:number;operation:string};
  steps?:{number:number;operation:string;status:string;input_name?:string;started_at?:string;finished_at?:string;duration_ms?:number}[];
  error?:{code:string;category?:string;cause_code?:string;message:string;outcome?:string;retry_safe?:boolean;step?:number;verification?:{output:string;reason:string}};
};

const words=(value:string)=>value.replaceAll('_',' ');
const duration=(value?:number)=>value===undefined?'—':value<1000?`${value} ms`:`${(value/1000).toFixed(1)} s`;

export function ExecutionDetails({run,active=false}:{run:ExecutionObservation;active?:boolean}) {
  const step=run.current_step;
  return <section className="execution-details" aria-label="Execution details">
    {(run.workflow_version||run.execution_mode)&&<dl className="execution-timing"><div><dt>Workflow version</dt><dd>{run.workflow_revision?`Revision ${run.workflow_revision}`:run.workflow_version?'Tested draft':'Historical run'}{run.workflow_version&&<code title={run.workflow_version}> · {run.workflow_version.slice(0,12)}</code>}</dd></div><div><dt>Execution mode</dt><dd>{run.execution_mode==='managed_local'?'Managed local browser':run.execution_mode==='connected_chrome'?'Connected Chrome':'Not recorded'}</dd></div></dl>}
    <p className="execution-phase" role={active?'status':undefined}>{run.phase==='verifying'?'Verifying captured outputs':active&&step?`Step ${step.number} of ${step.total} · ${words(step.operation)}`:active?'Waiting for the local runtime':run.outcome==='verified'?'Result verified':run.outcome==='unknown'?'Website outcome is unknown':'Execution finished'}</p>
    {!!run.steps?.length&&<ol className="execution-steps" aria-label="Step history">{run.steps.map(step=>{
      const Icon=step.status==='running'?Loader2:step.status==='succeeded'?Check:step.status==='failed'?OctagonAlert:Circle;
      return <li key={step.number} data-state={step.status}><span className="execution-step-number">{step.number}</span><Icon size={14} aria-hidden="true" className={step.status==='running'?'spin':undefined}/><div><strong>{words(step.operation)}</strong>{step.input_name&&<small>Input: <code>{step.input_name}</code></small>}</div><span className="execution-step-state">{words(step.status)}</span><time>{duration(step.duration_ms)}</time></li>;
    })}</ol>}
    {(run.queue_duration_ms!==undefined||run.execution_ms!==undefined)&&<dl className="execution-timing"><div><dt>Queue wait</dt><dd>{duration(run.queue_duration_ms)}</dd></div><div><dt>Execution</dt><dd>{duration(run.execution_ms)}</dd></div></dl>}
    {run.error&&<div className="execution-failure" role="alert"><strong>{run.error.outcome==='unknown'?'Inspect the website before retrying':'Execution needs attention'}</strong><p>{run.error.message}</p><dl><div><dt>Error code</dt><dd><code>{run.error.code}</code></dd></div>{run.error.cause_code&&run.error.cause_code!==run.error.code&&<div><dt>Cause</dt><dd><code>{run.error.cause_code}</code></dd></div>}{run.error.category&&run.error.category!==run.error.code&&<div><dt>Category</dt><dd><code>{run.error.category}</code></dd></div>}{run.error.verification&&<><div><dt>Output</dt><dd><code>{run.error.verification.output}</code></dd></div><div><dt>Observed</dt><dd>{words(run.error.verification.reason)}</dd></div></>}{run.error.step&&<div><dt>Failed step</dt><dd>{run.error.step}</dd></div>}</dl>{run.error.retry_safe===false&&<small>Cancellation and timeouts cannot undo a website submission. Hermo does not repeat uncertain actions.</small>}</div>}
  </section>;
}
