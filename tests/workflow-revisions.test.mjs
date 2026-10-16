import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {createWorkflowRevisions,executionConnection} from '../server/workflow-revisions.mjs';

function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'hermo-revisions-')),master=randomBytes(32).toString('base64'),previous=process.env.HERMO_MASTER_KEY;
  process.env.HERMO_MASTER_KEY=master;
  let store=openStore(directory);
  if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const connection={id:'conn_saved',name:'Saved website',url:'https://example.com/start',origins:['https://example.com'],access:'account',browser_mode:'connected',browser_workspace_id:'browser_saved',identity:{kind:'selected_tab',origin:'https://example.com'},checkpoint:'https://example.com/recorded',storageState:{cookies:[{name:'secret-cookie',value:'do-not-copy'}]}};
  const definition={version:'tested-hash-1',steps:[{op:'fill',selector:'#search',parameter:'query'}],inputs:{query:{type:'string',example:'old example'}},outputs:[{name:'result',selector:'#result'}],verifiers:[{kind:'nonempty',output:'result'}]};
  store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(connection.id,connection.name,connection.url,'connected',store.seal(connection),'2026-10-15T00:00:00.000Z');
  function add(status='published',id='wf_saved',version=definition.version,testVersion=version){
    const d={...structuredClone(definition),version};
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(id,connection.id,'Saved action',id,status,version,store.seal(d),testVersion,'2026-10-15T00:00:00.000Z');
    return {id,connection_id:connection.id,status,version,test_version:testVersion,definition:d};
  }
  return {directory,get store(){return store;},connection,definition,add,reopen(){store.close();process.env.HERMO_MASTER_KEY=master;try{store=openStore(directory);}finally{if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}return store;}};
}

test('legacy migration preserves IDs, scoped keys, runs and tested published/paused definitions',t=>{
  const f=fixture(t),published=f.add(),paused=f.add('paused','wf_paused'),draft=f.add('draft','wf_draft'),{store}=f;
  store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_saved','Existing key','hashed-secret','suffix',published.id,'2027-01-01',null,'2026-10-15');
  const oldPayload=store.seal({workflow_version:'historical-unknown-revision',result:{result:'historical output'}});
  store.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run_saved',published.id,'key_saved','old-idem','old-input-hash','succeeded',oldPayload,'2026-10-15','2026-10-15');
  const before=store.db.prepare('SELECT * FROM workflows ORDER BY id').all(),keys=store.db.prepare('SELECT * FROM api_keys').all();
  const revisions=createWorkflowRevisions(store);
  assert.equal(revisions.resolve(published).revision,1);assert.equal(revisions.resolve(paused).revision,1);assert.equal(revisions.resolve(draft),null);
  assert.deepEqual(store.db.prepare('SELECT * FROM workflows ORDER BY id').all(),before);
  assert.deepEqual(store.db.prepare('SELECT * FROM api_keys').all(),keys);
  assert.equal(store.db.prepare('SELECT payload FROM runs WHERE id=?').get('run_saved').payload,oldPayload);
  assert.equal(Object.hasOwn(store.unseal(oldPayload),'revision'),false);
  assert.equal(revisions.get(published.id,1).proof.kind,'legacy_test_version');
  assert.equal(revisions.history(published)[0].active,true);
  assert.equal(revisions.history(published)[0].execution_mode,'connected');
  createWorkflowRevisions(store);assert.equal(revisions.history(published).length,1);
});

test('publication is immutable, encrypted and survives draft edits and runtime restart',t=>{
  const f=fixture(t),workflow=f.add('draft'),revisions=createWorkflowRevisions(f.store),first=revisions.publish(workflow,f.connection);
  assert.equal(first.revision,1);assert.deepEqual(first.definition,workflow.definition);
  assert.equal(first.connection_config.storageState,undefined);assert.equal(first.connection_config.studioState,undefined);
  const row=f.store.db.prepare('SELECT * FROM workflow_revisions').get();
  for(const secret of ['#search','old example','https://example.com','do-not-copy'])assert.equal(row.payload.includes(secret),false);
  assert.throws(()=>f.store.db.prepare('UPDATE workflow_revisions SET version=? WHERE workflow_id=?').run('forged',workflow.id),/immutable/);
  const edited={...workflow.definition,version:'draft-hash-2',steps:[{op:'click',selector:'#different'}]};
  f.store.db.prepare("UPDATE workflows SET version=?,payload=?,test_version=NULL WHERE id=?").run(edited.version,f.store.seal(edited),workflow.id);
  const persisted=createWorkflowRevisions(f.reopen());
  assert.deepEqual(persisted.resolve(workflow).definition,workflow.definition);
  assert.equal(persisted.resolve(workflow).connection_config.checkpoint,f.connection.checkpoint);
  assert.equal(persisted.history(workflow).length,1);
});

test('publish re-reads tested state, rejects stale objects, and is idempotent for identical content',t=>{
  const f=fixture(t),workflow=f.add('draft'),revisions=createWorkflowRevisions(f.store);
  const first=revisions.publish(workflow,f.connection);
  assert.equal(revisions.publish(workflow,f.connection).revision,first.revision);
  f.store.db.prepare('UPDATE workflows SET test_version=NULL WHERE id=?').run(workflow.id);
  assert.throws(()=>revisions.publish(workflow,f.connection),{message:'TEST_REQUIRED'});
  const next={...workflow.definition,version:'tested-hash-2'};
  f.store.db.prepare('UPDATE workflows SET version=?,payload=?,test_version=? WHERE id=?').run(next.version,f.store.seal(next),next.version,workflow.id);
  assert.throws(()=>revisions.publish(workflow,f.connection),{message:'WORKFLOW_VERSION_CHANGED'});
  assert.equal(revisions.publish({...workflow,version:next.version},f.connection).revision,2);
  assert.equal(revisions.history(workflow).length,2);
  assert.equal(revisions.get(workflow.id,1).version,workflow.version);
});

test('rollback switches only the publication pointer and preserves the current draft and keys',t=>{
  const f=fixture(t),workflow=f.add('draft'),revisions=createWorkflowRevisions(f.store);
  revisions.publish(workflow,f.connection);
  const next={...workflow.definition,version:'tested-hash-2',outputs:[{name:'result',selector:'#new-result'}]};
  f.store.db.prepare('UPDATE workflows SET version=?,payload=?,test_version=? WHERE id=?').run(next.version,f.store.seal(next),next.version,workflow.id);
  revisions.publish({...workflow,version:next.version},f.connection);
  const before=f.store.db.prepare('SELECT * FROM workflows WHERE id=?').get(workflow.id);
  assert.equal(revisions.rollback(workflow.id,1).revision,1);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM workflows WHERE id=?').get(workflow.id),before);
  assert.equal(revisions.resolve(workflow).revision,1);assert.equal(revisions.history(workflow).length,2);
  assert.throws(()=>revisions.rollback(workflow.id,99),{message:'REVISION_NOT_FOUND'});
  assert.equal(revisions.resolve(workflow).revision,1);
});

test('published connection policy cannot expand or follow changed browser identities',t=>{
  const f=fixture(t),workflow=f.add(),revision=createWorkflowRevisions(f.store).resolve(workflow);
  const live={...f.connection,status:'connected',checkpoint:'https://example.com/new-page',origins:[...f.connection.origins,'https://later.example'],storageState:{cookies:[{name:'fresh-session'}]}};
  const execution=executionConnection(live,revision);
  assert.deepEqual(execution.origins,f.connection.origins);assert.equal(execution.checkpoint,f.connection.checkpoint);
  assert.deepEqual(execution.storageState,live.storageState);assert.equal(execution.status,'connected');
  for(const changed of [{id:'unrelated'},{url:'https://example.com/other'},{origins:[]},{access:'public'},{browser_mode:'isolated'},{browser_workspace_id:'replacement'},{identity:{kind:'selected_tab',origin:'https://other.example'}}])assert.throws(()=>executionConnection({...live,...changed},revision),{message:'REVISION_PERMISSION_CHANGED'});
  revision.connection_config.origins.push('https://client-mutated.example');
  const saved=createWorkflowRevisions(f.store).resolve(workflow);assert.deepEqual(saved.connection_config.origins,f.connection.origins);
});

test('rollback rejects revoked origin permissions and leaves the active publication untouched',t=>{
  const f=fixture(t),workflow=f.add(),revisions=createWorkflowRevisions(f.store);
  const next={...workflow.definition,version:'tested-hash-2'};
  f.store.db.prepare('UPDATE workflows SET version=?,payload=?,test_version=? WHERE id=?').run(next.version,f.store.seal(next),next.version,workflow.id);
  revisions.publish({...workflow,version:next.version},f.connection);
  f.store.db.prepare('UPDATE connections SET payload=? WHERE id=?').run(f.store.seal({...f.connection,origins:[]}),f.connection.id);
  assert.throws(()=>revisions.rollback(workflow.id,1),{message:'REVISION_PERMISSION_CHANGED'});
  assert.equal(revisions.resolve(workflow).revision,2);
});

test('legacy unverified rows are preserved without manufacturing verified proof',t=>{
  const f=fixture(t),workflow=f.add('published','wf_unverified','legacy-hash',null),revisions=createWorkflowRevisions(f.store);
  assert.equal(revisions.resolve(workflow).revision,1);assert.equal(revisions.resolve(workflow).proof.kind,'legacy_unverified');
  assert.equal(revisions.resolve(workflow).test_version,null);
  assert.throws(()=>revisions.rollback(workflow.id,1),{message:'TEST_REQUIRED'});
  assert.throws(()=>revisions.publish(workflow,f.connection),{message:'TEST_REQUIRED'});
});

test('migration is transactional, foreign-key guarded and cascades workflow deletion',t=>{
  const f=fixture(t),workflow=f.add(),revisions=createWorkflowRevisions(f.store);
  assert.throws(()=>f.store.db.prepare('INSERT INTO workflow_publications VALUES (?,?,?)').run('missing-workflow',1,'now'),/FOREIGN KEY/);
  assert.throws(()=>f.store.db.prepare('UPDATE workflow_publications SET revision=999 WHERE workflow_id=?').run(workflow.id),/FOREIGN KEY/);
  assert.equal(revisions.resolve(workflow).revision,1);
  f.store.db.prepare('DELETE FROM workflows WHERE id=?').run(workflow.id);
  assert.equal(revisions.get(workflow.id,1),null);assert.equal(revisions.resolve(workflow.id),null);assert.deepEqual(revisions.history(workflow.id),[]);
});

test('lazy import supports legacy rows inserted after module initialization',t=>{
  const f=fixture(t),revisions=createWorkflowRevisions(f.store),workflow=f.add();
  assert.equal(revisions.resolve(workflow),null);
  assert.equal(revisions.ensureLegacy(workflow,f.connection).revision,1);
  assert.equal(revisions.ensureLegacy(workflow,f.connection).revision,1);
  assert.equal(revisions.get(workflow.id,0),null);assert.equal(revisions.get(workflow.id,1.5),null);assert.equal(revisions.get('missing',1),null);
});

test('explicit draft marker is independent from the publication and is cleared transactionally on publish',t=>{
  const f=fixture(t),workflow=f.add(),revisions=createWorkflowRevisions(f.store);
  assert.equal(revisions.isDraftOpen(workflow),false);
  revisions.openDraft(workflow);revisions.openDraft(workflow.id);
  assert.equal(revisions.isDraftOpen(workflow),true);assert.equal(revisions.resolve(workflow).revision,1);
  f.store.db.prepare('UPDATE workflows SET test_version=NULL WHERE id=?').run(workflow.id);
  assert.throws(()=>revisions.publish(workflow,f.connection),{message:'TEST_REQUIRED'});
  assert.equal(revisions.isDraftOpen(workflow),true);
  f.store.db.prepare('UPDATE workflows SET test_version=version WHERE id=?').run(workflow.id);
  revisions.publish(workflow,f.connection);assert.equal(revisions.isDraftOpen(workflow),false);
  revisions.openDraft(workflow);revisions.clearDraft(workflow);assert.equal(revisions.isDraftOpen(workflow),false);
  revisions.openDraft(workflow);f.store.db.prepare('DELETE FROM workflows WHERE id=?').run(workflow.id);
  assert.equal(revisions.isDraftOpen(workflow),false);
});

test('a failed legacy migration rolls back all schema and imported revisions',t=>{
  const f=fixture(t);f.add();f.add('published','wf_invalid');
  f.store.db.prepare('UPDATE workflows SET payload=? WHERE id=?').run('invalid-ciphertext','wf_invalid');
  assert.throws(()=>createWorkflowRevisions(f.store));
  assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='workflow_revisions'").get(),undefined);
  assert.equal(f.store.db.prepare('SELECT count(*) count FROM workflows').get().count,2);
});
