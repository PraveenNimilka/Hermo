import {useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {History, X} from 'lucide-react';
import {WorkflowChanges,type WorkflowChangeReview} from './WorkflowChanges';

type Revision={revision:number;version:string;created_at:string;execution_mode:string;active:boolean};
type RevisionHistory={active_revision:number|null;draft_version:string;draft_open:boolean;revisions:Revision[]};
type RevisionWorkflow={id:string;name:string;version:string;status:string;published_revision?:number|null;has_draft_changes?:boolean};
type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
type Difference={before:Record<string,unknown>;after:Record<string,unknown>;changed:string[];execution_changed:boolean;changes?:WorkflowChangeReview};
type Review={kind:'draft'|'rollback';revision:Revision;expectedVersion:string;expectedActive:number|null;difference?:Difference;acknowledged?:boolean};

export function WorkflowRevisions({workflow,request,onRefresh,onEditDraft}:{workflow:RevisionWorkflow;request:Request;onRefresh:()=>Promise<void>|void;onEditDraft?:()=>void}){
  const[open,setOpen]=useState(false),[history,setHistory]=useState<RevisionHistory|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[review,setReview]=useState<Review|null>(null),[difference,setDifference]=useState<Difference|null>(null),[comparing,setComparing]=useState(false);
  const cancelRef=useRef<HTMLButtonElement>(null),reviewReturn=useRef<HTMLElement|null>(null);
  const path=`/studio/workflows/${encodeURIComponent(workflow.id)}`;
  async function load(){setLoading(true);setError('');try{setHistory(await request<RevisionHistory>(`${path}/revisions`));}catch(cause){setError(message(cause));}finally{setLoading(false);}}
  function show(){setDifference(null);setNotice('');setReview(null);setHistory(null);setOpen(true);void load();}
  async function choose(kind:Review['kind'],revision:Revision){if(!history)return;reviewReturn.current=document.activeElement as HTMLElement;setError('');setComparing(true);try{const difference=kind==='rollback'&&history.active_revision?await request<Difference>(`${path}/revision-diff?from=${history.active_revision}&to=${revision.revision}`):undefined;setReview({kind,revision,expectedVersion:history.draft_version,expectedActive:history.active_revision,difference,acknowledged:false});}catch(cause){setError(message(cause));}finally{setComparing(false);}}
  async function compare(revision:Revision){if(!history?.active_revision)return;setComparing(true);setError('');try{setDifference(await request<Difference>(`${path}/revision-diff?from=${revision.revision}&to=${history.active_revision}`));}catch(cause){setError(message(cause));}finally{setComparing(false);}}
  async function editDraft(){if(!history||busy)return;setBusy(true);setError('');try{
    if(workflow.status!=='draft'&&!history.draft_open)await request(`${path}/draft`,{expected_version:history.draft_version});
    await onRefresh();setOpen(false);onEditDraft?.();
  }catch(cause){setError(message(cause));}finally{setBusy(false);}}
  async function confirm(){if(!review||busy||review.kind==='rollback'&&review.difference?.changes&&(review.difference.changes.breaking||review.difference.changes.permission_review_required)&&!review.acknowledged)return;setBusy(true);setError('');try{
    if(review.kind==='draft')await request(`${path}/draft`,{expected_version:review.expectedVersion,revision:review.revision.revision});
    else await request(`${path}/rollback`,{revision:review.revision.revision,expected_active_revision:review.expectedActive,...review.difference?.changes?{change_fingerprint:review.difference.changes.fingerprint,accept_breaking:review.acknowledged===true,permissions_reviewed:review.acknowledged===true}:{}});
    const kind=review.kind,number=review.revision.revision;
    setReview(null);setNotice(kind==='draft'?`Revision ${number} is ready as an editable draft. Test and publish it to change the live API.`:`The live API now uses revision ${number}.`);
    await load();await onRefresh();
  }catch(cause){setError(message(cause));}finally{setBusy(false);}}
  return <div className="workflow-revisions">
    <Dialog.Root open={open} onOpenChange={value=>{if(!busy){setOpen(value);if(!value)setReview(null);}}}>
      <Dialog.Trigger asChild><button type="button" className="button secondary" onClick={show}><History size={16} aria-hidden="true"/><span>Version history</span></button></Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay workflow-revisions"/><Dialog.Content className="dialog-content workflow-revisions" onInteractOutside={event=>{if(busy)event.preventDefault();}} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
        <div className="dialog-heading"><div><Dialog.Title>Workflow versions</Dialog.Title><Dialog.Description>{workflow.name} · Published revisions stay fixed while you edit a draft.</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="Close version history" disabled={busy}><X size={20} aria-hidden="true"/></button></Dialog.Close></div>
        <div className="dialog-body" aria-busy={loading||busy}>
          {loading&&<p role="status">Loading saved revisions…</p>}
          {!review&&error&&<p className="workflow-revisions-message" role="alert">{error}</p>}
          {notice&&<p className="workflow-revisions-message" role="status">{notice}</p>}
          {history&&<>
            <dl className="workflow-revisions-summary"><div><dt>Live revision</dt><dd>{history.active_revision===null?'Not published':`Revision ${history.active_revision}`}</dd></div><div><dt>Working draft</dt><dd><code>{shortVersion(history.draft_version)}</code>{workflow.has_draft_changes&&<span> · Unpublished changes</span>}</dd></div></dl>
            <p className="workflow-revisions-help">Restoring a revision replaces the working draft and clears its verification. Rolling back switches the live API to a previously published revision.</p>
            {history.revisions.length===0?<div className="workflow-revisions-empty"><p>No published revisions yet.</p><p>Test this workflow and publish it to save its first revision.</p></div>:<ol className="workflow-revisions-list">{history.revisions.map(revision=><li key={revision.revision}>
              <div className="workflow-revisions-meta"><div className="workflow-revisions-name"><strong>Revision {revision.revision}</strong>{revision.active&&<span className="pill quiet">Live</span>}</div><time dateTime={revision.created_at}>{formatDate(revision.created_at)}</time><code title={revision.version}>{shortVersion(revision.version)}</code></div>
              <div className="workflow-revisions-actions">{!revision.active&&history.active_revision!==null&&<button type="button" className="button ghost" disabled={busy||loading||comparing} onClick={()=>void compare(revision)}>Compare with live</button>}<button type="button" className="button secondary" disabled={busy||loading} aria-label={`Restore revision ${revision.revision} as draft`} onClick={()=>choose('draft',revision)}>Restore as draft</button>{!revision.active&&history.active_revision!==null&&<button type="button" className="button ghost" disabled={busy||loading} aria-label={`Roll back live API to revision ${revision.revision}`} onClick={()=>choose('rollback',revision)}>Roll back live API</button>}</div>
            </li>)}</ol>}
          </>}
          {difference&&<section className="revision-difference" aria-label="Revision comparison"><h3>Revision {String(difference.before.revision)} → live revision {String(difference.after.revision)}</h3><p>{difference.changed.length?'Changed: '+difference.changed.join(', '):'The workflow definitions are identical.'}{difference.execution_changed?' Execution permissions or browser binding changed.':''}</p>{difference.changes&&<WorkflowChanges review={difference.changes}/>}<div><details><summary>Selected contract and steps</summary><pre tabIndex={0}>{JSON.stringify(difference.before,null,2)}</pre></details><details><summary>Live contract and steps</summary><pre tabIndex={0}>{JSON.stringify(difference.after,null,2)}</pre></details></div></section>}
          <div className="dialog-footer"><button type="button" className="button ghost" disabled={busy||loading} onClick={()=>void load()}>Refresh versions</button>{onEditDraft&&<button type="button" className="button secondary" disabled={busy||loading||!history} onClick={()=>void editDraft()}>Open draft</button>}<Dialog.Close asChild><button type="button" className="button secondary" disabled={busy}>Done</button></Dialog.Close></div>
        </div>
        <Dialog.Root open={!!review} onOpenChange={value=>{if(!value&&!busy){setReview(null);setError('');}}}>
          <Dialog.Portal><Dialog.Overlay className="dialog-overlay workflow-revisions"/><Dialog.Content role="alertdialog" className="dialog-content workflow-revisions" onOpenAutoFocus={event=>{event.preventDefault();cancelRef.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();reviewReturn.current?.isConnected&&reviewReturn.current.focus({preventScroll:true});}} onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
            <div className="dialog-heading"><div><Dialog.Title>{review?.kind==='draft'?'Restore working draft?':'Change the live API revision?'}</Dialog.Title><Dialog.Description>{review?.kind==='draft'?`Replace the working draft of ${workflow.name} with revision ${review.revision.revision}.`:`Switch ${workflow.name} from revision ${review?.expectedActive} to revision ${review?.revision.revision}.`}</Dialog.Description></div></div>
            <div className="dialog-body"><p>{review?.kind==='draft'?'Unpublished draft changes will be replaced. The live API stays on its current revision. Verify the restored draft before publishing.':'New API requests will use this saved revision. Review its input and output contract before changing integrations. The working draft is preserved.'}</p>{review&&<dl className="workflow-revisions-summary"><div><dt>Selected revision</dt><dd>Revision {review.revision.revision}</dd></div><div><dt>Saved version</dt><dd><code>{shortVersion(review.revision.version)}</code></dd></div></dl>}{review?.kind==='rollback'&&review.difference?.changes&&<><WorkflowChanges review={review.difference.changes}/>{(review.difference.changes.breaking||review.difference.changes.permission_review_required)&&<label className="checkbox-row"><input type="checkbox" checked={review.acknowledged===true} onChange={event=>setReview({...review,acknowledged:event.target.checked})}/><span>I reviewed this revision’s contract and website permissions and authorize changing the live API.</span></label>}</>}{error&&<p className="workflow-revisions-message" role="alert">{error}</p>}<div className="dialog-footer"><Dialog.Close asChild><button type="button" className="button secondary" ref={cancelRef} disabled={busy}>Cancel</button></Dialog.Close><button type="button" className="button primary" disabled={busy||!!(review?.kind==='rollback'&&review.difference?.changes&&(review.difference.changes.breaking||review.difference.changes.permission_review_required)&&!review.acknowledged)} aria-busy={busy} onClick={()=>void confirm()}>{busy?'Applying change…':review?.kind==='draft'?'Restore draft':'Confirm rollback'}</button></div></div>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}

const message=(cause:unknown)=>cause instanceof Error?cause.message:'The revision could not be loaded or changed. Refresh versions and try again.';
const shortVersion=(version:string)=>version.length>16?`${version.slice(0,16)}…`:version;
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleString();}
