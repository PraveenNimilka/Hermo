import {z} from 'zod';

const views=z.enum(['pending','history']);
const text=value=>typeof value==='string'?value.slice(0,160):undefined;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;
const operations=new Set(['invocation','navigate','click','fill','select','check','wait_element','wait_url','wait_text','wait_delay','wait_navigation','wait_output','wait_response']);
const statuses=new Set(['pending','approved','rejected','expired','cancelled']);
const risks=new Set(['website_action','navigation','unspecified','low','medium','high','critical']);
const cursorSchema=z.object({view:views,at:z.string().datetime(),id:z.string().min(1).max(100),approval_at:z.string().datetime().optional(),approval_id:z.string().min(1).max(100).optional()}).strict()
  .refine(value=>(value.approval_at===undefined)===(value.approval_id===undefined));
const querySchema=z.object({view:views.default('pending'),limit:z.coerce.number().int().min(1).max(100).default(25),cursor:z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).optional()}).strict();
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

function safeApproval(value,row,payload){
  if(!value||typeof value!=='object'||typeof value.id!=='string'||value.id.length>100||!value.id||!Number.isInteger(value.step)||value.step<0||value.step>32||!operations.has(value.operation)||!statuses.has(value.status)||(value.step===0)!==(value.operation==='invocation')||value.step===0&&value.scope!=='invocation'||value.step>0&&value.scope!==undefined)return null;
  const requested_at=date(value.requested_at),expires_at=date(value.expires_at);
  if(!requested_at||!expires_at)return null;
  const source=value.context??{},context={workflow_id:row.workflow_id,workflow_name:text(source.workflow_name)??text(row.workflow_name)??'Workflow',proposed_value_redacted:true};
  const version=text(payload.workflow_version??source.workflow_version);if(version)context.workflow_version=version;
  if(['connected_chrome','managed_local'].includes(payload.execution_mode??source.execution_mode))context.execution_mode=payload.execution_mode??source.execution_mode;
  try{const url=new URL(source.website_origin);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)context.website_origin=url.origin;}catch{}
  if(risks.has(source.risk))context.risk=source.risk;
  if(text(source.description)!==undefined)context.description=text(source.description);
  if(source.target&&typeof source.target==='object'){
    context.target={framed:source.target.framed===true};
    for(const key of ['role','name'])if(text(source.target[key])!==undefined)context.target[key]=text(source.target[key]);
  }
  const approval={id:value.id,step:value.step,operation:value.operation,...value.step===0?{scope:'invocation'}:{},status:value.status,requested_at,expires_at,context};
  if(date(value.decided_at))approval.decided_at=date(value.decided_at);
  if(['workspace_owner','runtime'].includes(value.actor))approval.actor=value.actor;
  if(Number.isFinite(value.wait_ms)&&value.wait_ms>=0)approval.wait_ms=Math.min(value.wait_ms,Number.MAX_SAFE_INTEGER);
  return approval;
}

// /studio owner-session, CSRF, Host and Origin hooks must be installed by the
// runtime before this installer. No consumer approval or decision route is added.
export function installApprovalInbox(app,{store,fail}){
  const {db,unseal}=store;
  db.exec('CREATE INDEX IF NOT EXISTS runs_approval_history_order ON runs(created_at DESC,id DESC); CREATE INDEX IF NOT EXISTS runs_approval_pending_order ON runs(status,created_at DESC,id DESC);');
  app.get('/studio/approvals',async req=>{
    const parsed=querySchema.safeParse(req.query);
    if(!parsed.success)fail('INVALID_REQUEST','Choose pending approvals or approval history and a valid page size.');
    const {view,limit,cursor}=parsed.data;let after;
    if(cursor){try{after=cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));}catch{fail('INVALID_REQUEST','This approval page is invalid. Refresh the inbox.');}
      if(after.view!==view)fail('INVALID_REQUEST','Refresh the selected approval view before continuing.');}
    // Bound decryption work even when many historical runs had no approvals.
    // A continuation cursor advances through empty scan windows as well.
    const clauses=[],parameters=[];
    if(view==='pending')clauses.push("r.status IN ('running','awaiting_approval')");
    if(after){clauses.push(`(r.created_at<? OR (r.created_at=? AND r.id${after.approval_id?'<=':'<'}?))`);parameters.push(after.at,after.at,after.id);}
    const rows=db.prepare(`SELECT r.id,r.workflow_id,r.status,r.payload,r.created_at,w.name workflow_name FROM runs r JOIN workflows w ON w.id=r.workflow_id ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY r.created_at DESC,r.id DESC LIMIT 257`).all(...parameters);
    const items=[],now=Date.now();let next_cursor=null;
    for(const [rowIndex,row]of rows.slice(0,256).entries()){
      let payload;try{payload=unseal(row.payload);}catch{fail('APPROVAL_HISTORY_UNAVAILABLE','Approval history could not be read. Keep the saved data and inspect runtime diagnostics.',500);}
      const history=new Map();for(const raw of (Array.isArray(payload.approval_history)?payload.approval_history.slice(-32):[])){const value=safeApproval(raw,row,payload);if(value)history.set(value.id,value);}
      const current=safeApproval(payload.approval,row,payload);if(current)history.set(current.id,current);
      const records=[...history.values()].sort((a,b)=>b.requested_at.localeCompare(a.requested_at)||b.id.localeCompare(a.id));
      for(const [recordIndex,approval]of records.entries()){
        if(after?.approval_id&&row.id===after.id&&(approval.requested_at>after.approval_at||approval.requested_at===after.approval_at&&approval.id>=after.approval_id))continue;
        const expired=Date.parse(approval.expires_at)<=now;
        const actionable=row.status==='running'&&payload.phase==='awaiting_approval'&&current?.id===approval.id&&approval.status==='pending'&&!expired;
        if(view==='pending'?!actionable:actionable)continue;
        items.push({run_id:row.id,workflow_id:row.workflow_id,workflow_name:approval.context.workflow_name,
          workflow_version:approval.context.workflow_version??null,workflow_revision:Number.isSafeInteger(payload.workflow_revision)&&payload.workflow_revision>0?payload.workflow_revision:null,
          execution_mode:approval.context.execution_mode??null,run_status:row.status,approval,actionable,expired});
        if(items.length===limit){
          if(recordIndex<records.length-1||rowIndex<rows.length-1)next_cursor=encode({view,at:row.created_at,id:row.id,approval_at:approval.requested_at,approval_id:approval.id});
          return {view,items,next_cursor};
        }
      }
      if(rowIndex===255&&rows.length>256)next_cursor=encode({view,at:row.created_at,id:row.id});
    }
    return {view,items,next_cursor};
  });
}
