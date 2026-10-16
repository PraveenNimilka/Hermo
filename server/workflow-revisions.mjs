import {hash} from './store.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const failure=code=>Object.assign(Error(code),{code});
const workflowId=workflow=>typeof workflow==='string'?workflow:workflow.id;
const revisionNumber=value=>Number.isSafeInteger(value)&&value>0?value:undefined;

// Freeze execution policy, never credentials. An isolated browser may use its
// current encrypted session, but published entry pages and permissions stay put.
export function snapshotConnection(connection){
  const config={id:connection.id,url:connection.url,origins:[...new Set(connection.origins)].sort(),access:connection.access??'account',browser_mode:connection.browser_mode??'isolated'};
  for(const key of ['checkpoint','identity','browser_profile_id','browser_workspace_id'])if(connection[key]!==undefined)config[key]=clone(connection[key]);
  return config;
}

export function executionConnection(current,revision){
  const saved=revision?.connection_config;
  if(!saved||current.id!==saved.id)throw failure('REVISION_PERMISSION_CHANGED');
  const live=snapshotConnection(current);
  // Additional origins approved later do not expand a published revision.
  // Removing a saved origin, changing account identity, or replacing its
  // browser binding requires a new tested publication instead of a fallback.
  if(saved.origins.some(origin=>!live.origins.includes(origin))||['url','access','browser_mode','identity','browser_profile_id','browser_workspace_id'].some(key=>canonical(live[key])!==canonical(saved[key])))throw failure('REVISION_PERMISSION_CHANGED');
  return {...current,...clone(saved),checkpoint:saved.checkpoint??saved.url};
}

export function createWorkflowRevisions(store){
  const {db,seal,unseal}=store;
  function transaction(operation){
    db.exec('SAVEPOINT workflow_revision_change');
    try{const result=operation();db.exec('RELEASE workflow_revision_change');return result;}
    catch(error){db.exec('ROLLBACK TO workflow_revision_change; RELEASE workflow_revision_change');throw error;}
  }
  const readWorkflow=value=>{
    const row=db.prepare('SELECT * FROM workflows WHERE id=?').get(workflowId(value));
    if(!row)throw failure('WORKFLOW_NOT_FOUND');
    return {...row,definition:unseal(row.payload)};
  };
  const readConnection=(workflow,supplied)=>{
    const row=db.prepare('SELECT * FROM connections WHERE id=?').get(workflow.definition.execution_connection_id??workflow.connection_id);
    if(!row||supplied&&supplied.id!==row.id)throw failure('REVISION_PERMISSION_CHANGED');
    return {...row,...unseal(row.payload)};
  };
  function get(id,revision){
    if(!revisionNumber(revision))return null;
    const row=db.prepare('SELECT * FROM workflow_revisions WHERE workflow_id=? AND revision=?').get(workflowId(id),revision);
    if(!row)return null;
    return {workflow_id:row.workflow_id,revision:row.revision,version:row.version,test_version:row.test_version,created_at:row.created_at,execution_mode:row.execution_mode,proof_hash:row.proof_hash,...unseal(row.payload)};
  }
  function resolve(workflow,revision){
    if(revision!==undefined)return get(workflowId(workflow),revision);
    const active=db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(workflowId(workflow));
    return active?get(workflowId(workflow),active.revision):null;
  }
  function activate(id,revision){
    db.prepare('INSERT INTO workflow_publications (workflow_id,revision,activated_at) VALUES (?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET revision=excluded.revision,activated_at=excluded.activated_at').run(id,revision,new Date().toISOString());
    return get(id,revision);
  }
  function insert(workflow,connection,legacy=false){
    const config=snapshotConnection(connection),revision=db.prepare('SELECT coalesce(max(revision),0)+1 revision FROM workflow_revisions WHERE workflow_id=?').get(workflow.id).revision;
    const tested=workflow.test_version===workflow.version&&workflow.definition.version===workflow.version;
    const proof={kind:tested?(legacy?'legacy_test_version':'verified_test_version'):'legacy_unverified',workflow_version:workflow.version,test_version:workflow.test_version??null};
    const proofHash=hash(canonical({definition:workflow.definition,connection_config:config,proof}));
    db.prepare('INSERT INTO workflow_revisions (workflow_id,revision,version,test_version,payload,created_at,execution_mode,proof_hash) VALUES (?,?,?,?,?,?,?,?)').run(workflow.id,revision,workflow.version,workflow.test_version??null,seal({definition:workflow.definition,connection_config:config,proof}),new Date().toISOString(),config.browser_mode,proofHash);
    return activate(workflow.id,revision);
  }
  function ensureLegacy(value,suppliedConnection){
    return transaction(()=>{
      const workflow=readWorkflow(value),active=resolve(workflow);
      if(active)return active;
      if(!['published','paused'].includes(workflow.status))return null;
      if(db.prepare('SELECT 1 FROM workflow_revisions WHERE workflow_id=? LIMIT 1').get(workflow.id))return null;
      return insert(workflow,readConnection(workflow,suppliedConnection),true);
    });
  }
  transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS workflow_revisions (
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK(revision>0),version TEXT NOT NULL,test_version TEXT,
      payload TEXT NOT NULL,created_at TEXT NOT NULL,execution_mode TEXT NOT NULL,proof_hash TEXT NOT NULL,
      PRIMARY KEY(workflow_id,revision)
    );
    CREATE TABLE IF NOT EXISTS workflow_publications (
      workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,activated_at TEXT NOT NULL,
      FOREIGN KEY(workflow_id,revision) REFERENCES workflow_revisions(workflow_id,revision)
    );
    CREATE TABLE IF NOT EXISTS workflow_drafts (
      workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,opened_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS workflow_revisions_immutable BEFORE UPDATE ON workflow_revisions
      BEGIN SELECT RAISE(ABORT,'Published workflow revisions are immutable'); END;`);
    for(const row of db.prepare("SELECT * FROM workflows WHERE status IN ('published','paused')").all())ensureLegacy(row);
  });
  return {
    get,resolve,ensureLegacy,snapshotConnection,executionConnection,
    isDraftOpen(value){return !!db.prepare('SELECT 1 FROM workflow_drafts WHERE workflow_id=?').get(workflowId(value));},
    // The route owns row edits and its enclosing transaction. This marker
    // explicitly authorizes editing while publication availability is separate.
    openDraft(value){
      const workflow=readWorkflow(value);
      db.prepare('INSERT INTO workflow_drafts (workflow_id,opened_at) VALUES (?,?) ON CONFLICT(workflow_id) DO NOTHING').run(workflow.id,new Date().toISOString());
      return {workflow_id:workflow.id};
    },
    clearDraft(value){db.prepare('DELETE FROM workflow_drafts WHERE workflow_id=?').run(workflowId(value));},
    publish(value,suppliedConnection){
      return transaction(()=>{
        const workflow=readWorkflow(value);
        // Re-read persisted state inside the transaction: a stale UI object or
        // in-memory caller cannot publish an edited or untested definition.
        if(typeof value!=='string'&&value.version!==workflow.version)throw failure('WORKFLOW_VERSION_CHANGED');
        if(workflow.test_version!==workflow.version||workflow.definition.version!==workflow.version)throw failure('TEST_REQUIRED');
        const connection=readConnection(workflow,suppliedConnection),active=resolve(workflow);
        const revision=active?.version===workflow.version&&canonical(active.connection_config)===canonical(snapshotConnection(connection))&&active.proof.kind!=='legacy_unverified'?active:insert(workflow,connection);
        db.prepare('DELETE FROM workflow_drafts WHERE workflow_id=?').run(workflow.id);
        return revision;
      });
    },
    rollback(value,revision){
      return transaction(()=>{
        const workflow=readWorkflow(value),target=get(workflow.id,revision);
        if(!target)throw failure('REVISION_NOT_FOUND');
        if(target.test_version!==target.version||target.proof.kind==='legacy_unverified')throw failure('TEST_REQUIRED');
        const row=db.prepare('SELECT * FROM connections WHERE id=?').get(target.connection_config.id);
        if(!row)throw failure('REVISION_PERMISSION_CHANGED');
        executionConnection({...row,...unseal(row.payload)},target);
        return activate(workflow.id,revision);
      });
    },
    history(value){
      return db.prepare('SELECT r.workflow_id,r.revision,r.version,r.test_version,r.created_at,r.execution_mode,r.proof_hash,CASE WHEN p.revision=r.revision THEN 1 ELSE 0 END active FROM workflow_revisions r LEFT JOIN workflow_publications p ON p.workflow_id=r.workflow_id WHERE r.workflow_id=? ORDER BY r.revision DESC').all(workflowId(value)).map(row=>({...row,active:!!row.active}));
    }
  };
}
