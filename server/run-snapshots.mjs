import {hash} from './store.mjs';
import {snapshotConnection} from './workflow-revisions.mjs';

// Definitions and account selectors remain encrypted and private, outside the
// consumer-visible run payload. Retention/deletion cascades only run snapshots.
export function createRunSnapshots({db,seal,unseal}){
  db.exec(`CREATE TABLE IF NOT EXISTS run_snapshots (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workflow_test_evidence (
    workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_version TEXT NOT NULL,config_hash TEXT NOT NULL,run_id TEXT NOT NULL,tested_at TEXT NOT NULL
  );`);
  const configHash=connection=>hash(JSON.stringify(snapshotConnection(connection)));
  return {
    save(runId,workflow,connection,revision=null){
      const value={definition:workflow.definition,connection_config:snapshotConnection(connection),workflow_revision:revision,version:workflow.version};
      db.prepare('INSERT INTO run_snapshots (run_id,payload) VALUES (?,?)').run(runId,seal(value));
      return value;
    },
    get(runId){const row=db.prepare('SELECT payload FROM run_snapshots WHERE run_id=?').get(runId);return row?unseal(row.payload):null;},
    verified(workflowId,runId){
      const row=db.prepare('SELECT consumer_id,status,payload FROM runs WHERE id=? AND workflow_id=?').get(runId,workflowId);
      const saved=this.get(runId);
      if(!saved||row?.consumer_id!=='studio'||row.status!=='succeeded'||unseal(row.payload).outcome!=='verified')throw Error('TEST_REQUIRED');
      db.prepare('INSERT INTO workflow_test_evidence VALUES (?,?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET workflow_version=excluded.workflow_version,config_hash=excluded.config_hash,run_id=excluded.run_id,tested_at=excluded.tested_at').run(workflowId,saved.version,hash(JSON.stringify(saved.connection_config)),runId,new Date().toISOString());
    },
    isTested(workflow,connection){
      const proof=db.prepare('SELECT * FROM workflow_test_evidence WHERE workflow_id=?').get(workflow.id);
      return workflow.test_version===workflow.version&&proof?.workflow_version===workflow.version&&proof.config_hash===configHash(connection);
    },
    clear(workflowId){db.prepare('DELETE FROM workflow_test_evidence WHERE workflow_id=?').run(workflowId);}
  };
}
