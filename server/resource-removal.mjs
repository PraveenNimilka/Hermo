import {z} from 'zod';

// Deletion is owner-only through the existing /studio/ hooks. Confirmation is
// checked against the current name so a stale dialog cannot delete a renamed item.
export function installResourceRemoval(app,{store,fail,controllers,removing}) {
  const {db,audit}=store;
  const bodySchema=z.object({confirmation:z.string().max(220)}).strict();
  const confirm=(body,name)=>{
    const parsed=bodySchema.safeParse(body);
    if(!parsed.success)fail('CONFIRMATION_REQUIRED',`Type Delete "${name}" to confirm.`,400);
    if(parsed.data.confirmation!==`Delete "${name}"`)fail('CONFIRMATION_MISMATCH',`Type Delete "${name}" exactly to confirm.`,400);
  };
  const activeSql="status IN ('queued','running','verifying')";
  const connectionGuard=cid=>{
    if(removing.has(cid))fail('CONNECTION_REMOVING','This connection is being removed.',409);
  };

  app.post('/studio/workflows/:wid/remove',async req=>{
    const w=db.prepare('SELECT id,name,connection_id FROM workflows WHERE id=?').get(req.params.wid);
    if(!w)fail('NOT_FOUND','Action not found.',404);
    confirm(req.body,w.name);connectionGuard(w.connection_id);
    if([...controllers.values()].some(r=>r.workflowId===w.id)||db.prepare(`SELECT id FROM runs WHERE workflow_id=? AND ${activeSql} LIMIT 1`).get(w.id))
      fail('ACTION_BUSY','Finish or cancel this action\u2019s active runs before deleting it.',409);
    removing.add(w.connection_id);
    try{
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('DELETE FROM runs WHERE workflow_id=?').run(w.id);
        db.prepare('DELETE FROM api_keys WHERE workflow_id=?').run(w.id);
        db.prepare('DELETE FROM workflows WHERE id=?').run(w.id);
        audit('action.removed',w.id);db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return {ok:true};
    }finally{removing.delete(w.connection_id);}
  });

  app.post('/studio/keys/:kid/remove',async req=>{
    const key=db.prepare('SELECT k.id,k.name,w.connection_id FROM api_keys k JOIN workflows w ON w.id=k.workflow_id WHERE k.id=?').get(req.params.kid);
    if(!key)fail('NOT_FOUND','API key not found.',404);
    confirm(req.body,key.name);connectionGuard(key.connection_id);
    if([...controllers.values()].some(r=>r.consumerId===key.id)||db.prepare(`SELECT id FROM runs WHERE consumer_id=? AND ${activeSql} LIMIT 1`).get(key.id))
      fail('KEY_BUSY','Finish or cancel this key\u2019s active runs before deleting it.',409);
    // Completed runs retain their consumer id and idempotency record. Removing
    // authorization must not permit a website submission to be replayed.
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('DELETE FROM api_keys WHERE id=?').run(key.id);
      audit('key.removed',key.id);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {ok:true};
  });
}
