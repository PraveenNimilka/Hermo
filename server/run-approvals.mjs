import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {persistRun,transitionRun} from './run-state.mjs';

const decisionSchema=z.object({approval_id:z.string().uuid(),decision:z.enum(['approve','reject'])}).strict();
const text=value=>typeof value==='string'?value.slice(0,160):undefined;
export function approvalWebsiteOrigin(connection,definition,index){
  const navigation=definition.steps.slice(0,index+1).findLast(step=>step.enabled!==false&&step.op==='navigate');
  return new URL(navigation?.url??navigation?.template??connection.checkpoint??connection.url).origin;
}
function safeContext(context,operation){
  if(!context)return undefined;
  const value={operation,proposed_value_redacted:true};
  for(const key of ['workflow_id','workflow_name','workflow_version','execution_mode','input_name','description'])if(text(context[key])!==undefined)value[key]=text(context[key]);
  if(context.website_origin){try{const url=new URL(context.website_origin);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)value.website_origin=url.origin;}catch{}}
  if(['website_action','navigation','unspecified','low','medium','high','critical'].includes(context.risk))value.risk=context.risk;
  if(context.target){value.target={framed:context.target.framed===true};for(const key of ['role','name'])if(text(context.target[key])!==undefined)value.target[key]=text(context.target[key]);}
  return value;
}
function recordDecision(payload,approval,status,actor,at=new Date().toISOString()){
  if(approval.status!=='pending')return;
  Object.assign(approval,{status,actor,decided_at:at,wait_ms:Math.max(0,Date.parse(at)-Date.parse(approval.requested_at))});
  const historical=payload.approval_history?.find(item=>item.id===approval.id);
  if(historical)Object.assign(historical,approval);
}

export function createRunApprovals({store,fail}){
  const {db,audit}=store,pending=new Map();
  const active=id=>db.prepare('SELECT status FROM runs WHERE id=?').get(id)?.status==='running';
  const persist=(id,payload)=>persistRun(store,id,'running',payload,['running']);

  async function wait({id,payload,index,operation,signal,expiresAt,authorize,context}){
    if(signal.aborted)throw signal.reason;
    authorize();
    if(!active(id))throw Error('WORKFLOW_CANCELLED');
    if(Date.now()>=expiresAt)throw Error('TIMEOUT');
    const invocation=index===-1&&operation==='invocation';
    if(!Number.isInteger(index)||index< -1||index===-1&&!invocation||index>=0&&operation==='invocation'||pending.has(id))throw Error('INVALID_RUN_TRANSITION');
    if(invocation?(payload.phase!=='running'||!Array.isArray(payload.steps)||payload.steps.some(step=>step.status!=='pending')||payload.approval_history?.some(approval=>approval.scope==='invocation')):payload.steps?.[index]?.status!=='running')throw Error('INVALID_RUN_TRANSITION');
    const safe=safeContext(context,operation);
    const stepId=payload.steps?.[index]?.step_id;
    const approval={id:randomUUID(),step:index+1,.../^step_[A-Za-z0-9_-]{8,80}$/.test(stepId??'')?{step_id:stepId}:{},operation,...invocation?{scope:'invocation'}:{},status:'pending',requested_at:new Date().toISOString(),expires_at:new Date(expiresAt).toISOString(),requested_by:'runtime',...safe?{context:safe}:{}};
    transitionRun(payload,'awaiting_approval');payload.approval=approval;
    payload.approval_history=[...(payload.approval_history??[]).slice(-31),JSON.parse(JSON.stringify(approval))];
    if(payload.steps?.[index])payload.steps[index].status='awaiting_approval';
    let resolveDecision,rejectDecision;
    const decided=new Promise((resolve,reject)=>{resolveDecision=resolve;rejectDecision=reject;});
    const cancel=()=>rejectDecision(signal.reason??Error('WORKFLOW_CANCELLED'));
    const timer=setTimeout(()=>rejectDecision(Error('TIMEOUT')),Math.max(1,expiresAt-Date.now()));
    pending.set(id,{approval,payload,resolve:resolveDecision,reject:rejectDecision,signal,expiresAt,authorize});
    signal.addEventListener('abort',cancel,{once:true});
    try{
      if(!persist(id,payload))throw Error('WORKFLOW_CANCELLED');audit('run.approval_requested',id);
      if(signal.aborted)cancel();
      await decided;
      if(signal.aborted)throw signal.reason;
      if(!active(id))throw Error('WORKFLOW_CANCELLED');
      if(Date.now()>=expiresAt)throw Error('TIMEOUT');
      authorize();
      transitionRun(payload,'running');
      if(payload.steps?.[index])payload.steps[index].status='running';
      if(!persist(id,payload))throw Error('WORKFLOW_CANCELLED');
    }catch(error){
      if(approval.status==='pending'){
        recordDecision(payload,approval,['TIMEOUT','WORKFLOW_TIMEOUT'].includes(error?.message)?'expired':'cancelled','runtime');
        // A concurrent terminal writer owns its own payload; never overwrite it.
        if(active(id))persist(id,payload);
      }
      throw error;
    }finally{
      clearTimeout(timer);signal.removeEventListener('abort',cancel);pending.delete(id);
    }
  }

  function decide(id,body){
    const parsed=decisionSchema.safeParse(body);
    if(!parsed.success)fail('INVALID_REQUEST','Choose this run’s current approval and a decision.');
    const item=pending.get(id);
    if(!item||!active(id)||item.signal.aborted||item.approval.status!=='pending'||item.approval.id!==parsed.data.approval_id||Date.now()>=item.expiresAt)fail('APPROVAL_UNAVAILABLE','This approval expired or the run is no longer waiting.',409);
    try{item.authorize();}catch{fail('APPROVAL_UNAVAILABLE','Execution authority changed. Cancel this run and inspect its permissions.',409);}
    recordDecision(item.payload,item.approval,parsed.data.decision==='approve'?'approved':'rejected','workspace_owner');
    if(!persist(id,item.payload))fail('APPROVAL_UNAVAILABLE','This approval expired or the run is no longer waiting.',409);
    audit('run.approval_'+item.approval.status,id);
    if(parsed.data.decision==='approve')item.resolve();else item.reject(Error('APPROVAL_REJECTED'));
    return {ok:true};
  }
  return {wait,decide};
}
