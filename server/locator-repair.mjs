import {z} from 'zod';
import {hash,id} from './store.mjs';
import {validateWorkflowSteps,workflowLocatorSchema} from './workflow-steps.mjs';

const stepId=z.string().regex(/^step_[A-Za-z0-9_-]{8,80}$/),short=z.string().max(160);
const reasons=z.enum(['EXACT_SEMANTIC_MATCH','EXACT_TEST_ID_MATCH','EXACT_CSS_MATCH','SAME_CONTROL_ROLE','OPERATION_COMPATIBLE']);
const candidateSchema=z.object({element_id:z.string().uuid(),selector:z.string().min(1).max(3000),locators:z.array(workflowLocatorSchema).min(1).max(4),role:z.string().max(40).optional(),name:short.optional(),score:z.number().int().min(0).max(100),reasons:z.array(reasons).min(1).max(4)}).strict();
export const locatorProbeResultSchema=z.object({document_id:z.string().uuid(),matches:z.number().int().min(0).max(15000),visible:z.boolean(),enabled:z.boolean(),semantic_match:z.boolean(),element_id:z.string().uuid().optional(),role:z.string().max(40).optional(),name:short.optional(),candidates:z.array(candidateSchema).max(8).optional()}).strict();
const supported=new Set(['click','fill','select','check','wait_element','wait_text']);
const clone=value=>JSON.parse(JSON.stringify(value));
const target=step=>Object.fromEntries(['selector','locators','frame_path'].filter(key=>step[key]!==undefined).map(key=>[key,clone(step[key])]));

// Owner-only, observation-only repair. Tickets confer no browser action authority
// and expire in memory; the published workflow remains immutable.
export function installLocatorRepair(app,{store,workflow,executionConnectionFor,connection,engine,revisions,snapshots,safeWorkflow,assertConnectionIdle,isRecording,fail,rate,origin}){
  const tickets=new Map(),ttl=60000;
  const parse=(schema,body)=>{const value=schema.safeParse(body);if(!value.success)fail('INVALID_LOCATOR_REPAIR','Choose a saved step and its current repair observation.');return value.data;};
  const base={expected_version:z.string().min(1).max(100),step_id:stepId};
  function scope(wid,body){
    const w=workflow(wid);if(w.version!==body.expected_version)fail('VERSION_CHANGED','This draft changed. Save or reload it before inspecting its target.',409);
    if(w.status!=='draft'&&!revisions.isDraftOpen(w))fail('DRAFT_REQUIRED','Open a working draft before repairing a target.',409);
    const index=w.definition.steps.findIndex(step=>step.id===body.step_id),step=w.definition.steps[index];
    if(!step||!supported.has(step.op))fail('STEP_TARGET_REQUIRED','Save this draft first and select a step with an element target.',409);
    const c=executionConnectionFor(w);assertConnectionIdle(c.id);
    if(isRecording(c.id))fail('RECORDING_ACTIVE','Finish or discard recording before inspecting workflow targets.',409);
    if(c.status!=='connected'||!engine.isOpen(c.id))fail('BROWSER_CLOSED','Open and confirm this workflow’s authorized browser before inspecting its target.',409);
    if(c.browser_mode==='connected'&&step.frame_path?.length)fail('EXECUTION_INCOMPATIBLE','Connected-tab repair does not support framed steps.',409);
    return {w,c,index,step,binding:hash(c.payload+':'+c.status)};
  }
  function fresh(previous,body){const current=scope(previous.w.id,body);if(current.c.id!==previous.c.id||current.binding!==previous.binding)fail('REPAIR_OBSERVATION_CHANGED','The browser session changed. Inspect the target again.',409);return current;}
  async function observe(s,payload){
    try{
      if(typeof engine.probeTarget!=='function')throw Error('COMPANION_UPDATE_REQUIRED');
      return locatorProbeResultSchema.parse(await engine.probeTarget(s.c.id,payload,s.step.frame_path??[],s.c));
    }catch(error){
      if(error.publicCode)throw error;
      if(error.message==='COMPANION_UPDATE_REQUIRED')fail('COMPANION_UPDATE_REQUIRED','Reload the updated Hermo companion and reconnect this selected tab to inspect targets.',409);
      fail('PROBE_UNAVAILABLE','This target could not be inspected without running an action. Check the authorized browser, page size and target, then inspect again.',409);
    }
  }
  function prune(){for(const [key,value]of tickets)if(value.expiresAt<=Date.now())tickets.delete(key);while(tickets.size>=100)tickets.delete(tickets.keys().next().value);}
  function ticketFor(s,body){
    const ticket=tickets.get(body.ticket),candidate=ticket?.candidates.find(value=>value.id===body.candidate_id);
    if(!ticket||ticket.expiresAt<=Date.now()||ticket.wid!==s.w.id||ticket.version!==s.w.version||ticket.stepId!==s.step.id||ticket.cid!==s.c.id||ticket.binding!==s.binding||!candidate)fail('REPAIR_OBSERVATION_CHANGED','This observation expired or its workflow/browser changed. Inspect the target again.',409);
    return {ticket,candidate};
  }
  const candidateBody=z.object({...base,ticket:z.string().max(100),candidate_id:z.string().max(100)}).strict();
  async function probe(s,ticket,candidate,body){
    const result=await observe(s,{mode:'probe',selector:candidate.selector,locators:candidate.locators,operation:s.step.op});
    fresh(s,body);
    const unchanged=result.document_id===ticket.documentId&&result.element_id===candidate.element_id;
    return {matches:result.matches,visible:result.visible,enabled:result.enabled,semantic_match:result.semantic_match,unchanged};
  }
  app.post('/studio/workflows/:wid/locator-repair/suggestions',async req=>{
    rate('locator-repair',30);const body=parse(z.object(base).strict(),req.body),s=scope(req.params.wid,body);
    const {frame_path,...currentTarget}=target(s.step);
    const result=await observe(s,{mode:'candidates',...currentTarget,operation:s.step.op,limit:8});
    fresh(s,body);prune();
    const ticket=id('repair'),expiresAt=Date.now()+ttl;
    const candidates=(result.candidates??[]).map(candidate=>({...candidate,id:id('candidate'),repair_fingerprint:hash(JSON.stringify({version:s.w.version,step:s.step,connection:s.binding,document:result.document_id,candidate}))}));
    tickets.set(ticket,{wid:s.w.id,version:s.w.version,stepId:s.step.id,cid:s.c.id,binding:s.binding,documentId:result.document_id,expiresAt,candidates});
    return {version:s.w.version,step_id:s.step.id,ticket,expires_at:new Date(expiresAt).toISOString(),original:target(s.step),candidates:candidates.map(({element_id,...value})=>value)};
  });
  app.post('/studio/workflows/:wid/locator-repair/probe',async req=>{
    rate('locator-repair',30);const body=parse(candidateBody,req.body),s=scope(req.params.wid,body),{ticket,candidate}=ticketFor(s,body);
    return probe(s,ticket,candidate,body);
  });
  app.post('/studio/workflows/:wid/locator-repair/apply',async req=>{
    rate('locator-repair',30);const body=parse(candidateBody.extend({repair_fingerprint:z.string().length(64),authorized:z.literal(true)}),req.body),s=scope(req.params.wid,body),{ticket,candidate}=ticketFor(s,body);
    if(body.repair_fingerprint!==candidate.repair_fingerprint)fail('REPAIR_OBSERVATION_CHANGED','Review the exact current target change before applying it.',409);
    const result=await probe(s,ticket,candidate,body);
    if(result.matches!==1||!result.visible||!result.enabled||!result.semantic_match||!result.unchanged||ticket.expiresAt<=Date.now())fail('REPAIR_OBSERVATION_CHANGED','The observed target changed or is ambiguous. Inspect it again; no step was executed.',409);
    const current=fresh(s,body),definition=clone(current.w.definition);delete definition.version;
    const steps=clone(definition.steps);steps[current.index]={...steps[current.index],selector:candidate.selector,locators:clone(candidate.locators)};
    try{const checked=validateWorkflowSteps(steps,{inputs:definition.inputs,outputs:definition.outputs,origins:current.c.origins,sandboxOrigin:origin});definition.steps=steps;definition.steps[current.index]={...steps[current.index],selector:checked[current.index].selector,locators:checked[current.index].locators};}
    catch{fail('INVALID_LOCATOR_REPAIR','The proposed target is not valid for this workflow. Edit it manually and verify the draft.');}
    definition.version=hash(JSON.stringify(definition));
    store.db.exec('SAVEPOINT apply_locator_repair');
    try{
      const changed=store.db.prepare('UPDATE workflows SET payload=?,version=?,test_version=NULL WHERE id=? AND version=?').run(store.seal(definition),definition.version,current.w.id,current.w.version);
      if(changed.changes!==1)fail('VERSION_CHANGED','The working draft changed before this repair was saved.',409);
      snapshots.clear(current.w.id);store.audit('action.locator_repaired',current.w.id);store.db.exec('RELEASE apply_locator_repair');tickets.delete(body.ticket);
    }catch(error){store.db.exec('ROLLBACK TO apply_locator_repair; RELEASE apply_locator_repair');throw error;}
    return {workflow:safeWorkflow(store.db.prepare('SELECT * FROM workflows WHERE id=?').get(current.w.id))};
  });
  app.addHook('onClose',async()=>tickets.clear());
}
