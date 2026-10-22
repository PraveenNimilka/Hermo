import {useEffect,useRef,useState} from 'react';
import {WorkflowChanges,type WorkflowChangeReview} from './WorkflowChanges';
import './workflow-safety.css';

type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
type Target={selector?:string;locators?:{kind:string;value?:string;role?:string;name?:string}[];frame_path?:string[];attribute?:string;read_mode?:string};
type Output=Target&{name:string;type:string;required:boolean;fields?:Output[];items?:Output};
export type PermissionReview={
  workflow_id:string;version:string;revision:number|null;fingerprint:string;changes?:WorkflowChangeReview|null;accept_breaking?:boolean;
  connection:{id:string;name:string;website_origin:string;browser_workspace_id:string|null;mode:string;available:boolean};
  allowed_origins:string[];allowed_actions:string[];effect:string;timeout_seconds:number;
  inputs:{name:string;type:string;required:boolean}[];outputs:Output[];
  steps:(Target&{number:number;operation:string;enabled:boolean;approval_required:boolean;label?:string;input?:string;fixed_value?:boolean;destination_origin?:string;may_change_website:boolean})[];
  approval_invocation_required?:boolean;approval_steps:number[];legacy_target_steps:number[];
  key_scope:{workflow_id:string;operations:string[];can_approve:boolean};limitations:string[];
};

export function WorkflowPermissions({workflow,request,scope='draft',onReview}:{workflow:{id:string;version:string};request:Request;scope?:'draft'|'published';onReview?:(value:PermissionReview|null)=>void}){
  const [result,setResult]=useState<{identity:string;value:PermissionReview}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[checked,setChecked]=useState(false),[breakingAccepted,setBreakingAccepted]=useState(false),[attempt,setAttempt]=useState(0);
  const requestRef=useRef(request),reviewRef=useRef(onReview);
  requestRef.current=request;reviewRef.current=onReview;
  const identity=`${workflow.id}:${workflow.version}:${scope}`,review=result?.identity===identity?result.value:null;
  useEffect(()=>{
    let active=true;setResult(null);setError('');setLoading(true);setChecked(false);setBreakingAccepted(false);reviewRef.current?.(null);
    void requestRef.current<PermissionReview>(`/studio/workflows/${encodeURIComponent(workflow.id)}/permissions?scope=${scope}`).then(value=>{
      if(active){setResult({identity,value});setLoading(false);}
    }).catch(cause=>{if(active){setError(cause instanceof Error?cause.message:'Permissions could not be loaded. Please retry.');setLoading(false);}});
    return()=>{active=false;};
  },[workflow.id,workflow.version,scope,identity,attempt]);
  function acknowledge(permissions:boolean,breaking:boolean){reviewRef.current?.(review&&permissions&&(!review.changes?.breaking||breaking)?{...review,accept_breaking:breaking}:null);}
  return <section className="workflow-safety workflow-permissions" aria-label="Workflow permissions" aria-busy={loading}>
    <div className="safety-heading"><div><h3>Review workflow permissions</h3><p>This configuration preview does not run the workflow or change the website.</p></div>{review&&<span className="pill quiet">{scope==='published'?`Published revision ${review.revision??'unavailable'}`:'Working draft'}</span>}<button className="button secondary" type="button" disabled={loading} onClick={()=>setAttempt(value=>value+1)}>Refresh permission review</button></div>
    {loading&&<p role="status" className="safety-message">Loading workflow permissions…</p>}
    {error&&<div className="safety-message"><p role="alert">{error}</p><button className="button secondary" type="button" onClick={()=>setAttempt(value=>value+1)}>Retry permissions</button></div>}
    {review&&<>
      <dl className="safety-summary"><div><dt>Execution browser</dt><dd>{review.connection.mode==='connected_chrome'?'Connected Chrome tab':'Managed local browser'}</dd></div><div><dt>Authorized connection</dt><dd>{review.connection.name}<small>{review.connection.website_origin}</small><small>{review.connection.available?'Available now':'Currently unavailable'}</small></dd></div><div><dt>Workflow effect</dt><dd>{review.effect==='recorded_browser_actions'?'Recorded browser actions':'Page retrieval'}<small>Website behavior can still change data.</small></dd></div><div><dt>Total timeout</dt><dd>{review.timeout_seconds} seconds<small>Includes time waiting for approval.</small></dd></div></dl>
      <div className="safety-columns"><section><h4>Allowed website origins</h4><ul className="safety-values">{review.allowed_origins.map(origin=><li key={origin}><code>{origin}</code></li>)}</ul></section><section><h4>Allowed recorded actions</h4>{review.allowed_actions.length?<ul className="safety-values">{review.allowed_actions.map(action=><li key={action}>{operation(action)}</li>)}</ul>:<p className="muted">No enabled action steps. Declared outputs are extracted.</p>}</section></div>
      <section><h4>Ordered action preview</h4>{review.steps.length?<ol className="safety-timeline">{review.steps.map(step=><li key={step.number} className={step.enabled?'':'safety-disabled'}><div className="safety-step-title"><strong>{step.number}. {operation(step.operation)}{step.label?` · ${step.label}`:''}</strong><span className="pill quiet">{!step.enabled?'Disabled':step.approval_required?'Owner approval required':step.may_change_website?'May change website':'Observe / wait'}</span></div>{step.input&&<p>Input: <code>{step.input}</code></p>}{step.fixed_value&&<p>A fixed recorded value is used. Its content is hidden in this preview.</p>}{step.destination_origin&&<p>Destination origin: <code>{step.destination_origin}</code></p>}<TargetDetails target={step}/></li>)}</ol>:<p className="muted">No recorded action steps.</p>}</section>
      {review.approval_invocation_required&&<p className="safety-message">Every invocation pauses for owner approval before opening or reading the website, including this output-only workflow.</p>}
      {review.approval_steps.length>0&&<p className="safety-message">The runtime pauses before steps {review.approval_steps.join(', ')} until the workspace owner approves. API keys cannot approve these steps.</p>}
      {review.legacy_target_steps.length>0&&<p className="safety-message">Review the CSS targets in steps {review.legacy_target_steps.join(', ')}. A unique match may change meaning when a website changes. Prefer stable identifiers, roles, or labels.</p>}
      <div className="safety-columns"><section><h4>Dynamic inputs</h4>{review.inputs.length?<ul className="safety-mappings">{review.inputs.map(field=><li key={field.name}><code>{field.name}</code><span>{field.type} · {field.required?'Required':'Optional'}</span></li>)}</ul>:<p className="muted">No dynamic inputs.</p>}</section><section><h4>Returned data</h4><p className="muted">Only declared mappings are returned. Broad selections can include other visible information.</p><OutputMappings outputs={review.outputs}/></section></div>
      <section><h4>API key authority</h4><p>Keys can start this workflow and read or cancel their own runs. They cannot approve a paused step or authorize unrelated workflows.</p><p className="muted">Workflow: <code>{review.key_scope.workflow_id}</code></p></section>
      <details className="safety-details"><summary>Browser binding and safety limits</summary><dl className="safety-summary"><div><dt>Connection ID</dt><dd><code>{review.connection.id}</code></dd></div>{review.connection.browser_workspace_id&&<div><dt>Browser workspace</dt><dd><code>{review.connection.browser_workspace_id}</code></dd></div>}<div><dt>Definition version</dt><dd><code>{review.version}</code></dd></div></dl><ul className="safety-limits">{review.limitations.map(limit=><li key={limit}>{limit}</li>)}</ul></details>
      {scope==='draft'&&review.changes&&<WorkflowChanges review={review.changes}/>}
      {scope==='draft'&&onReview&&review.changes?.breaking&&<label className="checkbox-row safety-acknowledgment"><input type="checkbox" checked={breakingAccepted} onChange={event=>{setBreakingAccepted(event.target.checked);acknowledge(checked,event.target.checked);}}/><span>I reviewed the breaking API contract changes and will update affected clients.</span></label>}
      {scope==='draft'&&onReview&&<label className="checkbox-row safety-acknowledgment"><input type="checkbox" checked={checked} required onChange={event=>{setChecked(event.target.checked);acknowledge(event.target.checked,breakingAccepted);}}/><span>I reviewed this workflow’s permissions and possible website effects.</span></label>}
    </>}
  </section>;
}

function TargetDetails({target}:{target:Target}){
  if(!target.selector&&!target.locators?.length&&!target.frame_path?.length&&!target.attribute&&!target.read_mode)return null;
  return <details className="safety-details"><summary>Element target and extraction details</summary><dl className="safety-target">{target.selector&&<div><dt>CSS fallback</dt><dd><code>{target.selector}</code></dd></div>}{target.locators?.map((locator,index)=><div key={index}><dt>Locator {index+1} · {locator.kind}</dt><dd><code>{locator.kind==='role'?`${locator.role??''} · ${locator.name??''}`:locator.value}</code></dd></div>)}{target.frame_path?.length? <div><dt>Frame path</dt><dd><code>{target.frame_path.join(' → ')}</code></dd></div>:null}{target.attribute&&<div><dt>Attribute</dt><dd><code>{target.attribute}</code></dd></div>}{target.read_mode&&<div><dt>Read mode</dt><dd>{target.read_mode}</dd></div>}</dl></details>;
}
function OutputMappings({outputs}:{outputs:Output[]}){
  return outputs.length?<ul className="safety-mappings">{outputs.map((field,index)=><li key={`${field.name}:${index}`}><code>{field.name||'List item'}</code><span>{field.type} · {field.required?'Required':'Optional'}</span><TargetDetails target={field}/>{field.fields&&<OutputMappings outputs={field.fields}/>} {field.items&&<OutputMappings outputs={[field.items]}/>}</li>)}</ul>:<p className="muted">No output mappings.</p>;
}
const operation=(value:string)=>({click:'Click',fill:'Fill field',select:'Select option',check:'Set checkbox',navigate:'Navigate',wait_element:'Wait for element',wait_url:'Wait for URL',wait_text:'Wait for text'}[value]??value);
