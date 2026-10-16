import {z} from 'zod';
import {hash} from './store.mjs';
import {workflowExecutionCompatibility} from './execution-capabilities.mjs';

// A target is an independently authorized connection. Selecting it never copies
// cookies from Chrome, changes a publication, or proves managed authentication.
export function installExecutionTargets(app,{store,workflow,connection,projects,revisions,snapshots,assertConnectionIdle,isRecording,fail,origin}){
  const {db,seal,unseal,audit}=store;
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_execution_targets (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
    PRIMARY KEY(workflow_id,connection_id)
  )`);
  const remember=(wid,cid)=>db.prepare('INSERT OR IGNORE INTO workflow_execution_targets VALUES (?,?)').run(wid,cid);
  for(const row of db.prepare('SELECT id,connection_id,payload FROM workflows').all()){
    const target=unseal(row.payload).execution_connection_id;if(target&&target!==row.connection_id)remember(row.id,target);
    for(const revision of revisions.history(row)){
      const cid=revisions.get(row.id,revision.revision).connection_config.id;if(cid!==row.connection_id)remember(row.id,cid);
    }
  }
  const mode=c=>c.browser_mode==='connected'?'connected_chrome':'managed_local';
  function source(w){
    const cid=w.connection_config?.id??w.definition.execution_connection_id??w.connection_id,target=connection(cid),owner=connection(w.connection_id);
    if(cid!==owner.id&&(projects.projectId(cid)!==projects.projectId(owner.id)||new URL(target.url).origin!==new URL(owner.url).origin||target.origins.some(value=>!owner.origins.includes(value))))fail('EXECUTION_PERMISSION_CHANGED','The execution target must remain in the same project and within the source website permissions. Review and retest its binding.',409);
    return target;
  }
  app.get('/studio/workflows/:wid/execution',async req=>{
    const w=workflow(req.params.wid),owner=connection(w.connection_id),selected=w.definition.execution_connection_id??owner.id;
    const targets=db.prepare('SELECT * FROM connections').all().map(row=>({...row,...unseal(row.payload)})).filter(c=>projects.projectId(c.id)===projects.projectId(owner.id)&&new URL(c.url).origin===new URL(owner.url).origin&&c.origins.every(value=>owner.origins.includes(value))).map(c=>({id:c.id,name:c.name,mode:mode(c),status:c.status,selected:c.id===selected,...workflowExecutionCompatibility(c,w.definition,undefined,{sandboxOrigin:origin})}));
    return {selected_connection_id:selected,draft_open:w.status==='draft'||revisions.isDraftOpen(w),targets};
  });
  app.post('/studio/workflows/:wid/execution',async req=>{
    const w=workflow(req.params.wid),parsed=z.object({expected_version:z.string(),connection_id:z.string(),authorized:z.literal(true)}).strict().safeParse(req.body);
    if(!parsed.success)fail('INVALID_EXECUTION_CONFIG','Select and explicitly authorize an execution connection.');
    const body=parsed.data;if(w.version!==body.expected_version)fail('VERSION_CHANGED','Refresh the working draft before changing execution mode.',409);
    if(w.status!=='draft'&&!revisions.isDraftOpen(w))fail('DRAFT_REQUIRED','Open a working draft to change its execution target.',409);
    assertConnectionIdle(w.connection_id);assertConnectionIdle(body.connection_id);if(isRecording(w.connection_id)||isRecording(body.connection_id))fail('RECORDING_ACTIVE','Finish recording before changing execution mode.',409);
    const {version:previous,...definition}=w.definition;
    if(body.connection_id===w.connection_id)delete definition.execution_connection_id;else definition.execution_connection_id=body.connection_id;
    const c=source({...w,definition}),compatibility=workflowExecutionCompatibility(c,definition,undefined,{sandboxOrigin:origin});
    if(!compatibility.compatible)fail('EXECUTION_INCOMPATIBLE',compatibility.errors[0]?.message??'This target cannot execute this workflow.',409);
    if(c.status!=='connected')fail('AUTH_REQUIRED','Set up and confirm this dedicated website connection before selecting it.',409);
    definition.version=hash(JSON.stringify(definition));db.exec('BEGIN IMMEDIATE');try{
      if(c.id!==w.connection_id)remember(w.id,c.id);
      db.prepare('UPDATE workflows SET payload=?,version=?,test_version=NULL WHERE id=?').run(seal(definition),definition.version,w.id);snapshots.clear(w.id);audit('action.execution_target_changed',w.id);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {version:definition.version,execution_mode:mode(c)};
  });
  return {source,assertRemovable(cid){if(db.prepare('SELECT 1 FROM workflow_execution_targets WHERE connection_id=? LIMIT 1').get(cid))fail('CONNECTION_IN_USE','This connection is bound to a workflow draft or published revision. Delete those workflows before removing this connection.',409);}};
}
