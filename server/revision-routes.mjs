import {z} from 'zod';
import {inputJsonSchema,outputJsonSchema} from './workflow-contract.mjs';

// All routes inherit owner session, CSRF, Host and Origin checks from /studio.
export function installRevisionRoutes(app,{store,revisions,snapshots,workflow,connection,safeWorkflow,assertConnectionIdle,isRecording,fail}){
  const {db,seal,audit}=store;
  const read=(schema,value)=>{const parsed=schema.safeParse(value);if(!parsed.success)fail('INVALID_REQUEST','Check the selected revision and refresh this workflow.');return parsed.data;};
  const revisionNumber=z.number().int().positive().max(1000000);
  const transact=operation=>{db.exec('BEGIN IMMEDIATE');try{const value=operation();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const current=wid=>safeWorkflow(db.prepare('SELECT * FROM workflows WHERE id=?').get(wid));
  const ensure=w=>revisions.ensureLegacy(w,connection(w.connection_id));
  app.get('/studio/workflows/:wid/revisions',async req=>{
    const w=workflow(req.params.wid),active=ensure(w);
    return {active_revision:active?.revision??null,draft_version:w.version,draft_open:revisions.isDraftOpen(w),revisions:revisions.history(w)};
  });
  app.post('/studio/workflows/:wid/draft',async req=>{
    const w=workflow(req.params.wid),body=read(z.object({expected_version:z.string().min(1).max(100),revision:revisionNumber.optional()}).strict(),req.body);
    if(w.version!==body.expected_version)fail('VERSION_CHANGED','This draft changed. Refresh it before restoring a revision.',409);
    assertConnectionIdle(w.connection_id);
    if(isRecording(w.connection_id))fail('RECORDING_ACTIVE','Finish or discard this website recording before restoring a draft.',409);
    const active=ensure(w),source=body.revision===undefined?(revisions.isDraftOpen(w)?null:active):revisions.get(w,body.revision);
    if(body.revision!==undefined&&!source)fail('REVISION_NOT_FOUND','The selected published revision was not found.',404);
    transact(()=>{
      if(source)db.prepare('UPDATE workflows SET payload=?,version=?,test_version=NULL WHERE id=?').run(seal(source.definition),source.version,w.id);
      else db.prepare('UPDATE workflows SET test_version=NULL WHERE id=?').run(w.id);
      revisions.openDraft(w);snapshots.clear(w.id);audit('action.draft_opened',w.id);
    });
    return {workflow:current(w.id)};
  });
  app.post('/studio/workflows/:wid/rollback',async req=>{
    const w=workflow(req.params.wid),body=read(z.object({revision:revisionNumber,expected_active_revision:revisionNumber}).strict(),req.body),active=ensure(w);
    if(active?.revision!==body.expected_active_revision)fail('VERSION_CHANGED','The live revision changed. Refresh version history before rolling back.',409);
    if(!revisions.get(w,body.revision))fail('REVISION_NOT_FOUND','The selected revision was not found.',404);
    try{transact(()=>{revisions.rollback(w,body.revision);db.prepare("UPDATE workflows SET status='published' WHERE id=?").run(w.id);audit('action.rolled_back',w.id);});}
    catch(error){if(['TEST_REQUIRED','REVISION_PERMISSION_CHANGED'].includes(error.code))fail(error.code,error.code==='TEST_REQUIRED'?'Restore this historical revision into a draft and verify it before publishing.':'This revision’s browser or website permissions changed. Restore and retest it before publishing.',409);throw error;}
    return {workflow:current(w.id)};
  });
  app.get('/studio/workflows/:wid/revision-diff',async req=>{
    const w=workflow(req.params.wid);ensure(w);
    const body=read(z.object({from:z.coerce.number().int().positive(),to:z.coerce.number().int().positive()}).strict(),req.query);
    const left=revisions.get(w,body.from),right=revisions.get(w,body.to);
    if(!left||!right)fail('REVISION_NOT_FOUND','Both published revisions must exist.',404);
    const describe=revision=>({revision:revision.revision,version:revision.version,execution_mode:revision.execution_mode,input_schema:inputJsonSchema(revision.definition.inputs),output_schema:outputJsonSchema(revision.definition.outputs),steps:revision.definition.steps.map(step=>({operation:step.op,enabled:step.enabled!==false,input:step.parameter??step.path_parameter??null})),timeout_ms:revision.definition.timeout_ms??45000});
    const before=describe(left),after=describe(right);
    return {before,after,changed:['inputs','outputs','steps','verifiers','timeout_ms','effect'].filter(key=>JSON.stringify(left.definition[key])!==JSON.stringify(right.definition[key])),execution_changed:JSON.stringify(left.connection_config)!==JSON.stringify(right.connection_config)};
  });
}
