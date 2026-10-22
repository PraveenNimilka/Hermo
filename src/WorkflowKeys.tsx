import {useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import './workflow-safety.css';

type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
type WorkflowKey={id:string;name:string;suffix:string;workflow_id:string;expires_at:string;revoked_at:string|null;created_at:string};
type Secret={id:string;key:string;expires_at:string};
export function WorkflowKeys({workflow,request,onChanged,onCreated}:{workflow:{id:string;name:string};request:Request;onChanged:()=>void;onCreated:(secret:Secret)=>void}){
  const [result,setResult]=useState<{workflowId:string;keys:WorkflowKey[]}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState<{action:'revoke'|'rotate';key:WorkflowKey}|null>(null);
  const requestRef=useRef(request),cancelRef=useRef<HTMLButtonElement>(null),returnRef=useRef<HTMLElement|null>(null),headingRef=useRef<HTMLHeadingElement>(null);
  requestRef.current=request;
  useEffect(()=>{setNotice('');},[workflow.id]);
  useEffect(()=>{
    let active=true;setResult(null);setLoading(true);setError('');setConfirmation(null);
    void requestRef.current<{keys:WorkflowKey[]}>(`/studio/workflows/${encodeURIComponent(workflow.id)}/keys`).then(value=>{if(active){setResult({workflowId:workflow.id,keys:value.keys});setLoading(false);}}).catch(cause=>{if(active){setError(message(cause));setLoading(false);}});
    return()=>{active=false;};
  },[workflow.id,attempt]);
  const keys=result?.workflowId===workflow.id?result.keys:null;
  function choose(action:'revoke'|'rotate',key:WorkflowKey){returnRef.current=document.activeElement as HTMLElement;setError('');setNotice('');setConfirmation({action,key});}
  async function confirm(){
    if(!confirmation||busy)return;
    setBusy(true);setError('');
    try{
      const {action,key}=confirmation;
      const replacement=await request<Secret|{ok:boolean}>(`/studio/keys/${encodeURIComponent(key.id)}/${action}`,{});
      setConfirmation(null);setAttempt(value=>value+1);onChanged();
      if(action==='rotate')onCreated(replacement as Secret);
      else setNotice(`Key “${key.name}” was revoked. Other keys and browser connections remain available.`);
    }catch(cause){setError(message(cause));}finally{setBusy(false);}
  }
  return <section className="workflow-safety workflow-keys" aria-label="Workflow API keys" aria-busy={loading||busy}>
    <div className="safety-heading"><div><h3 ref={headingRef} tabIndex={-1}>API keys</h3><p>These keys authorize only {workflow.name}. They can run this workflow and read or cancel their own runs.</p></div><button type="button" className="button secondary" disabled={loading||busy} onClick={()=>setAttempt(value=>value+1)}>Refresh keys</button></div>
    <p className="muted">Revoking or rotating one key blocks its requests and cancels its queued or active runs. Other keys and workflows keep their browser connection. A website action already submitted cannot be undone.</p>
    <p className="muted">Keys cannot approve paused steps. Owner approval is required; waiting holds the execution queue and counts toward the run timeout.</p>
    {loading&&<p role="status" className="safety-message">Loading scoped API keys…</p>}
    {error&&!confirmation&&<div className="safety-message"><p role="alert">{error}</p><button type="button" className="button secondary" onClick={()=>setAttempt(value=>value+1)}>Retry keys</button></div>}
    {notice&&<p role="status" className="safety-message">{notice}</p>}
    {keys&&(keys.length?<ul className="safety-key-list">{keys.map(key=>{
      const expired=Date.parse(key.expires_at)<=Date.now(),active=!key.revoked_at&&!expired;
      return <li key={key.id}><div className="safety-key-meta"><div className="safety-step-title"><strong>{key.name}</strong><span className="pill quiet">{key.revoked_at?'Revoked':expired?'Expired':'Active'}</span></div><code>••••••{key.suffix}</code><p>{key.revoked_at?<>Revoked <time dateTime={key.revoked_at}>{date(key.revoked_at)}</time></>:<>Expires <time dateTime={key.expires_at}>{date(key.expires_at)}</time></>}</p></div><div className="safety-key-actions">{active&&<button type="button" className="button secondary" disabled={busy} aria-label={`Rotate key ${key.name}`} onClick={()=>choose('rotate',key)}>Rotate key</button>}{!key.revoked_at&&<button type="button" className="button secondary" disabled={busy} aria-label={`Revoke key ${key.name}`} onClick={()=>choose('revoke',key)}>Revoke key</button>}</div></li>;
    })}</ul>:<p className="safety-message">No keys for this workflow. Publish and verify the workflow before creating a scoped key.</p>)}
    <Dialog.Root open={!!confirmation} onOpenChange={open=>{if(!open&&!busy){setConfirmation(null);setError('');}}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content role="alertdialog" className="dialog-content workflow-safety safety-key-dialog" onOpenAutoFocus={event=>{event.preventDefault();cancelRef.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();(returnRef.current?.isConnected?returnRef.current:headingRef.current)?.focus({preventScroll:true});}} onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
      <div className="dialog-heading"><div><Dialog.Title>{confirmation?.action==='rotate'?'Rotate this API key?':'Revoke this API key?'}</Dialog.Title><Dialog.Description>{confirmation?.key.name} · {workflow.name}</Dialog.Description></div></div><div className="dialog-body"><p>{confirmation?.action==='rotate'?'The old key stops working immediately. A replacement key is shown once; update your integration before making another request.':'This key will stop working immediately. Applications using it must switch to another authorized key.'}</p><p>Queued and active runs started with this key are cancelled. Earlier website actions cannot be reversed. Other keys, workflows, and the browser connection stay available.</p>{error&&<p role="alert" className="safety-message">{error}</p>}<div className="dialog-footer"><Dialog.Close asChild><button type="button" className="button secondary" ref={cancelRef} disabled={busy}>Cancel</button></Dialog.Close><button type="button" className="button primary" disabled={busy} aria-busy={busy} onClick={()=>void confirm()}>{busy?'Applying change…':confirmation?.action==='rotate'?'Rotate key':'Revoke key'}</button></div></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
const message=(cause:unknown)=>cause instanceof Error?cause.message:'API keys could not be loaded or changed. Refresh the key list before trying again.';
function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Date unavailable':parsed.toLocaleString();}
