import {useEffect,useRef,useState} from 'react';
import {ExecutionDetails,type ExecutionObservation} from './ExecutionDetails';
import './approval-inbox.css';

type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
type Approval=NonNullable<ExecutionObservation['approval']>;
type Item={run_id:string;workflow_id:string;workflow_name:string;workflow_version:string|null;workflow_revision:number|null;execution_mode:string|null;run_status:string;approval:Approval;actionable:boolean;expired:boolean};
type Page={view:'pending'|'history';items:Item[];next_cursor:string|null};
const message=(cause:unknown)=>cause instanceof Error?cause.message:'Approvals could not be loaded. Try again.';
const format=(value:string)=>new Date(value).toLocaleString();

export function ApprovalInbox({request,onChanged}:{request:Request;onChanged?:()=>Promise<void>|void}){
  const [view,setView]=useState<'pending'|'history'>('pending'),[items,setItems]=useState<Item[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
  const requestRef=useRef(request),changedRef=useRef(onChanged),generation=useRef(0),viewRef=useRef(view);
  requestRef.current=request;changedRef.current=onChanged;viewRef.current=view;
  async function load(selected:'pending'|'history',next?:string){
    const ticket=++generation.current;setLoading(true);setError('');
    try{
      const page=await requestRef.current<Page>(`/studio/approvals?view=${selected}&limit=25${next?'&cursor='+encodeURIComponent(next):''}`);
      if(ticket!==generation.current)return;
      setItems(current=>next?[...current,...page.items.filter(item=>!current.some(previous=>previous.run_id===item.run_id&&previous.approval.id===item.approval.id))]:page.items);setCursor(page.next_cursor);
    }catch(cause){if(ticket===generation.current)setError(message(cause));}
    finally{if(ticket===generation.current)setLoading(false);}
  }
  useEffect(()=>{setItems([]);setCursor(null);void load(view);return()=>{generation.current++;};},[view]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  async function decide(item:Item,id:string,decision:'approve'|'reject'){
    await requestRef.current(`/studio/runs/${encodeURIComponent(item.run_id)}/approval`,{approval_id:id,decision});
    setItems(current=>current.filter(value=>value.run_id!==item.run_id||value.approval.id!==id));
    await load(viewRef.current);await changedRef.current?.();
  }
  return <section className="approval-inbox" aria-label="Approval inbox">
    <div className="approval-inbox-heading"><div><h2>Approvals</h2><p>Review protected website actions. Each decision applies to one step in one run.</p></div><button className="button secondary" type="button" disabled={loading} onClick={()=>void load(view)}>Refresh approvals</button></div>
    <div className="approval-inbox-controls" role="group" aria-label="Approval views"><button className="button secondary" type="button" aria-pressed={view==='pending'} onClick={()=>setView('pending')}>Pending approvals</button><button className="button secondary" type="button" aria-pressed={view==='history'} onClick={()=>setView('history')}>Approval history</button></div>
    {error&&<div className="notice error" role="alert"><p>{error}</p><button className="button secondary" type="button" disabled={loading} onClick={()=>void load(view)}>Retry approvals</button></div>}
    {loading&&<p role="status">Loading approvals…</p>}
    {!loading&&!error&&!items.length&&<div className="approval-inbox-empty"><h3>{view==='pending'?'No decisions waiting':'No approval events on this page'}</h3><p>{view==='pending'?'Protected workflow steps will appear here when they need your approval.':cursor?'Continue to earlier runs to inspect their approval history.':'Approved, rejected, expired and cancelled requests appear here.'}</p></div>}
    <ul className="approval-inbox-list" aria-busy={loading}>{items.map(item=>{
      const actionable=item.actionable&&Date.parse(item.approval.expires_at)>now;
      const label=item.approval.status==='pending'&&!actionable?(item.expired||Date.parse(item.approval.expires_at)<=now?'Expired · awaiting runtime settlement':'No longer actionable'):item.approval.status.replaceAll('_',' ');
      return <li key={`${item.run_id}:${item.approval.id}`}><article aria-label={`${item.workflow_name}, ${item.approval.step===0?'invocation approval':'step '+item.approval.step}`}><div className="approval-inbox-item-heading"><h3>{item.workflow_name}</h3><span className="pill quiet">{label}</span></div>
        {actionable?<ExecutionDetails run={{id:item.run_id,phase:'awaiting_approval',workflow_version:item.workflow_version??undefined,workflow_revision:item.workflow_revision,execution_mode:item.execution_mode??undefined,approval:item.approval}} active onDecision={(id,decision)=>decide(item,id,decision)}/>:<>
          <p>{item.approval.step===0?'Invocation approval':`Step ${item.approval.step} · ${item.approval.operation.replaceAll('_',' ')}`}</p><dl className="approval-inbox-metadata"><div><dt>Website</dt><dd>{item.approval.context?.website_origin??'Not recorded'}</dd></div><div><dt>Risk</dt><dd>{item.approval.context?.risk?.replaceAll('_',' ')??'Not classified'}</dd></div><div><dt>Requested</dt><dd><time dateTime={item.approval.requested_at}>{format(item.approval.requested_at)}</time></dd></div><div><dt>{item.approval.decided_at?'Decision recorded':'Expires'}</dt><dd><time dateTime={item.approval.decided_at??item.approval.expires_at}>{format(item.approval.decided_at??item.approval.expires_at)}</time></dd></div></dl><p className="small-text muted">Run <code>{item.run_id}</code>{item.workflow_revision?` · Revision ${item.workflow_revision}`:''}</p>
        </>}
      </article></li>;
    })}</ul>
    {cursor&&<button type="button" className="button secondary" disabled={loading} onClick={()=>void load(view,cursor)}>Load earlier approvals</button>}
  </section>;
}
