import {z} from 'zod';
import {hash} from './store.mjs';
import {inputFieldSchema,outputMappingSchema,validateOutputMappings,validateWorkflowContract} from './workflow-contract.mjs';
import {validateWorkflowSteps} from './workflow-steps.mjs';
import {verifierSchema,validateVerifiers} from './verification.mjs';
import {workflowExecutionCompatibility,executionCapabilities,workflowEffect} from './execution-capabilities.mjs';

const name=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
// Owner-only editing, inherited session/CSRF checks. Published revisions are
// never rewritten; saving invalidates only this draft's test evidence.
export function installWorkflowEditor(app,{store,workflow,connection,executionConnectionFor= w=>connection(w.connection_id),revisions,snapshots,safeWorkflow,assertConnectionIdle,isRecording,fail,origin}){
  const {db,seal,audit}=store;
  const view=w=>{const c=executionConnectionFor(w);return {definition:w.definition,version:w.version,draft_open:w.status==='draft'||revisions.isDraftOpen(w),execution_mode:c.browser_mode==='connected'?'connected_chrome':'managed_local',capabilities:executionCapabilities(c.browser_mode==='connected'?'connected_chrome':'managed_local'),compatibility:workflowExecutionCompatibility(c,w.definition,undefined,{sandboxOrigin:origin})};};
  app.get('/studio/workflows/:wid/editor',async req=>view(workflow(req.params.wid)));
  app.post('/studio/workflows/:wid/editor',async req=>{
    const w=workflow(req.params.wid),c=executionConnectionFor(w);
    if(w.status!=='draft'&&!revisions.isDraftOpen(w))fail('DRAFT_REQUIRED','Open a working draft before editing this workflow.',409);
    const parsed=z.object({expected_version:z.string().min(1).max(100),effect:z.enum(['retrieval','recorded_browser_actions']).optional(),steps:z.array(z.unknown()).max(32),inputs:z.record(name,inputFieldSchema),outputs:z.array(outputMappingSchema).min(1).max(8),verifiers:z.array(verifierSchema).max(24),timeout_seconds:z.number().int().min(15).max(300)}).strict().safeParse(req.body);
    if(!parsed.success)fail('INVALID_WORKFLOW_CONTRACT','Check the supported steps, fields and timeout settings.');
    const body=parsed.data;
    if(w.version!==body.expected_version)fail('VERSION_CHANGED','This working draft changed. Reopen it before saving.',409);
    assertConnectionIdle(c.id);if(isRecording(c.id))fail('RECORDING_ACTIVE','Finish recording before editing this workflow.',409);
    let definition;
    try{
      const steps=validateWorkflowSteps(body.steps,{inputs:body.inputs,origins:c.origins,sandboxOrigin:origin});
      validateOutputMappings(body.outputs);
      if(['search_extract','submit_form'].includes(w.definition.action_type)&&steps.some(step=>step.enabled!==false&&['fill','select','check','click'].includes(step.op))&&body.outputs.some(output=>!body.verifiers.some(rule=>rule.output===output.name&&['changed','equals_input'].includes(rule.kind??'equals_input'))))fail('FRESH_RESULT_REQUIRED','Add a Changed during this run check to each result, or match an echoed input explicitly. An earlier result cannot confirm a new request.',409);
      if(!validateVerifiers(body.verifiers,body.outputs,body.inputs))throw Error('INVALID_VERIFIER');
      const {version:old,...previous}=w.definition;
      definition=validateWorkflowContract({...previous,...body.effect?{effect:body.effect}:{},contract_version:'2',steps,inputs:body.inputs,outputs:body.outputs,verifiers:body.verifiers,timeout_ms:body.timeout_seconds*1000});
      definition.effect=workflowEffect(definition,c.browser_mode);
      const compatibility=workflowExecutionCompatibility(c,definition,undefined,{sandboxOrigin:origin});
      if(!compatibility.compatible)fail('EXECUTION_INCOMPATIBLE',compatibility.errors[0]?.message??'This browser mode cannot execute the configured workflow.',409);
      definition.version=hash(JSON.stringify(definition));
    }catch(error){if(error.publicCode)throw error;fail('INVALID_WORKFLOW_CONTRACT','Check locators, approved URLs, input usage, outputs and success checks.');}
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('UPDATE workflows SET payload=?,version=?,test_version=NULL WHERE id=?').run(seal(definition),definition.version,w.id);
      snapshots.clear(w.id);audit('action.draft_saved',w.id);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {workflow:safeWorkflow(db.prepare('SELECT * FROM workflows WHERE id=?').get(w.id)),...view(workflow(w.id))};
  });
}
