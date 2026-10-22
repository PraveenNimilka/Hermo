import {useEffect,useId,useRef,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import './locator-repair.css';

type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
type Locator={kind:string;value?:string;role?:string;name?:string};
type Target={selector?:string;locators?:Locator[];frame_path?:string[]};
type Candidate=Target&{id:string;selector:string;locators:Locator[];role?:string;name?:string;score:number;reasons:string[];repair_fingerprint:string};
type Suggestions={version:string;step_id:string;ticket:string;expires_at:string;original:Target;candidates:Candidate[]};
type Probe={matches:number;visible:boolean;enabled:boolean;semantic_match:boolean;unchanged:boolean};
type Props={workflowId:string;version:string;stepId?:string;disabled?:boolean;onApplied:(workflow:any)=>void;request:Request};
type Action='inspect'|'probe'|'apply';

export function LocatorRepair({workflowId,version,stepId,disabled,onApplied,request}:Props){
  const identity=JSON.stringify([workflowId,version,stepId]),identityRef=useRef(identity),generation=useRef(0),mounted=useRef(false),running=useRef(false);
  const requestRef=useRef(request),appliedRef=useRef(onApplied),id=useId();
  const [result,setResult]=useState<{identity:string;value:Suggestions}|null>(null),[candidateId,setCandidateId]=useState('');
  const [probe,setProbe]=useState<Probe|null>(null),[reviewed,setReviewed]=useState(false),[expired,setExpired]=useState(false);
  const [operation,setOperation]=useState<{identity:string;value:Action}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  identityRef.current=identity;requestRef.current=request;appliedRef.current=onApplied;
  const suggestions=result?.identity===identity?result.value:null,candidate=suggestions?.candidates.find(value=>value.id===candidateId);
  const action=operation?.identity===identity?operation.value:null,busy=action!==null,locked=disabled||busy||!stepId;
  const probePassed=probe?.matches===1&&probe.visible===true&&probe.enabled===true&&probe.semantic_match===true&&probe.unchanged===true;
  const expiredNow=expired||!!suggestions&&(!Number.isFinite(Date.parse(suggestions.expires_at))||Date.parse(suggestions.expires_at)<=Date.now());
  const endpoint=`/studio/workflows/${encodeURIComponent(workflowId)}/locator-repair`;

  useEffect(()=>{
    mounted.current=true;running.current=false;setResult(null);setCandidateId('');setProbe(null);setReviewed(false);setExpired(false);setOperation(null);setError('');setNotice('');
    return()=>{mounted.current=false;generation.current++;};
  },[identity]);
  useEffect(()=>{
    if(!suggestions)return;
    const remaining=Date.parse(suggestions.expires_at)-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0){setExpired(true);return;}
    const timer=setTimeout(()=>setExpired(true),Math.min(remaining,2147483647));return()=>clearTimeout(timer);
  },[suggestions]);

  async function perform(kind:Action){
    if(locked||running.current||!stepId)return;
    if(kind!=='inspect'&&(!suggestions||!candidate||expiredNow))return;
    if(kind==='apply'&&(!probePassed||!reviewed))return;
    const ticket=++generation.current,scope=identity;
    const active=()=>mounted.current&&identityRef.current===scope&&generation.current===ticket;
    running.current=true;setOperation({identity:scope,value:kind});setError('');setNotice('');
    try{
      if(kind==='inspect'){
        setResult(null);setProbe(null);setReviewed(false);setCandidateId('');setExpired(false);
        const value=await requestRef.current<Suggestions>(`${endpoint}/suggestions`,{expected_version:version,step_id:stepId});
        if(!active())return;
        if(value.version!==version||value.step_id!==stepId)throw new Error('The workflow or selected step changed. Save the current draft and inspect again.');
        setResult({identity:scope,value});
      }else if(kind==='probe'){
        setProbe(null);setReviewed(false);
        const value=await requestRef.current<Probe>(`${endpoint}/probe`,{expected_version:version,step_id:stepId,ticket:suggestions!.ticket,candidate_id:candidate!.id});
        if(active())setProbe(value);
      }else{
        const value=await requestRef.current<{workflow:any}>(`${endpoint}/apply`,{expected_version:version,step_id:stepId,ticket:suggestions!.ticket,candidate_id:candidate!.id,repair_fingerprint:candidate!.repair_fingerprint,authorized:true});
        if(!active())return;
        setResult(null);setProbe(null);setReviewed(false);setCandidateId('');setNotice('Target locators applied to the draft. Run workflow verification before publishing.');
        appliedRef.current(value.workflow);
      }
    }catch(cause){if(active())setError(cause instanceof Error?cause.message:'The target could not be inspected or changed. Check the authorized browser and try again.');}
    finally{if(active()){running.current=false;setOperation(null);}}
  }
  function choose(value:string){setCandidateId(value);setProbe(null);setReviewed(false);setError('');setNotice('');}

  return <details className="locator-repair">
    <summary>Inspect and repair target</summary>
    <div className="locator-repair-body" aria-busy={busy}>
      <p>Keep the existing authorized browser tab open. Save draft changes before inspecting its current target. Inspection and probing do not click, focus, navigate or scroll the website. A CSS-only target does not establish semantic identity.</p>
      {(!stepId||disabled)&&<p className="locator-repair-help">Save the draft and select a supported element step before inspecting.</p>}
      <button type="button" className="button secondary" disabled={locked} onClick={()=>void perform('inspect')}>{action==='inspect'&&<LoaderCircle size={16} className="spin" aria-hidden="true"/>}{action==='inspect'?'Inspecting target…':'Inspect current target'}</button>
      {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
      {suggestions&&<>
        <p className="locator-repair-help">Evidence scores describe matching DOM signals. They do not establish that an action is safe or that its business meaning is unchanged.</p>
        {expiredNow&&<p className="notice" role="status">This inspection expired. Inspect the current target again before probing or applying a change.</p>}
        {suggestions.candidates.length?<fieldset className="locator-repair-candidates" disabled={locked||expiredNow}><legend>Candidate targets</legend>{suggestions.candidates.map((value,index)=><label key={value.id} className="locator-repair-candidate"><input type="radio" name={`${id}-candidate`} value={value.id} checked={value.id===candidateId} onChange={()=>choose(value.id)} aria-describedby={`${id}-evidence-${index}`}/><span><strong>{value.name||value.role||'Element target'}{value.role&&value.name?<small> · {value.role}</small>:null}</strong><span className="locator-repair-score">Evidence score {value.score} / 100</span><span id={`${id}-evidence-${index}`} className="locator-repair-reasons">{value.reasons.length?value.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · '):'No matching evidence was recorded.'}</span><code>{value.selector}</code></span></label>)}</fieldset>:<div className="locator-repair-empty"><p>No candidate has enough recorded evidence to suggest a replacement. Review the detected fields in the authorized browser and edit the locator manually.</p></div>}
        {candidate&&<>
          <div className="locator-repair-comparison" aria-label="Locator change preview"><section><h5>Current draft target</h5><TargetDetails target={suggestions.original}/></section><section><h5>Selected replacement</h5><TargetDetails target={{...candidate,frame_path:suggestions.original.frame_path}}/></section></div>
          <button type="button" className="button secondary" disabled={locked||expiredNow} onClick={()=>void perform('probe')}>{action==='probe'&&<LoaderCircle size={16} className="spin" aria-hidden="true"/>}{action==='probe'?'Probing candidate…':'Probe selected candidate'}</button>
          {probe&&<div className="locator-repair-probe" role="status"><p>{probePassed?'One visible, enabled target matches the proposed locator checks. Review its locator change before applying.':'This candidate did not pass every target check. It cannot be applied. Inspect again or choose another candidate.'}</p><dl><div><dt>Matches</dt><dd>{probe.matches}</dd></div><div><dt>Visible</dt><dd>{probe.visible?'Yes':'No'}</dd></div><div><dt>Enabled</dt><dd>{probe.enabled?'Yes':'No'}</dd></div><div><dt>Semantic match</dt><dd>{probe.semantic_match?'No conflicts':'Conflict detected'}</dd></div><div><dt>Inspection still current</dt><dd>{probe.unchanged?'Yes':'No'}</dd></div></dl></div>}
          <label className="checkbox-row locator-repair-consent"><input type="checkbox" checked={reviewed} disabled={locked||expiredNow||!probePassed} onChange={event=>setReviewed(event.target.checked)}/><span>I reviewed this target change and authorize applying only its locators to this draft.</span></label>
          <p className="locator-repair-help">Applying a repair clears draft verification. Approval gates, inputs, outputs and the live published revision retain their definitions. Verify the complete workflow before publishing.</p>
          <button type="button" className="button primary" disabled={locked||expiredNow||!probePassed||!reviewed} onClick={()=>void perform('apply')}>{action==='apply'&&<LoaderCircle size={16} className="spin" aria-hidden="true"/>}{action==='apply'?'Applying locators…':'Apply locators to draft'}</button>
        </>}
      </>}
    </div>
  </details>;
}

function TargetDetails({target}:{target:Target}){
  return <dl className="locator-repair-target">{target.selector&&<div><dt>CSS target</dt><dd><code>{target.selector}</code></dd></div>}{target.locators?.map((locator,index)=><div key={index}><dt>{locator.kind==='role'?'Accessible role and name':locator.kind==='label'?'Associated label':locator.kind==='testId'?'Test identifier':'CSS candidate'}</dt><dd><code>{locator.kind==='role'?`${locator.role??''} · ${locator.name??''}`:locator.value}</code></dd></div>)}{!!target.frame_path?.length&&<div><dt>Frame path · retained</dt><dd><code>{target.frame_path.join(' → ')}</code></dd></div>}{!target.selector&&!target.locators?.length&&<div><dt>Target</dt><dd>No saved locator.</dd></div>}</dl>;
}
