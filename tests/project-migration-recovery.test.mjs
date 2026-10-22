import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {openStore} from '../server/store.mjs';
import {installProjects} from '../server/projects.mjs';

// Deterministic transaction fault injection, not a process-crash simulation.
test('failed additive project migration rolls back completely and retries without rewriting legacy resources',()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const store=openStore(resolve('work/project-migration-recovery',randomUUID()));
  try{
    const at='2026-10-01T00:00:00.000Z',cid='legacy_recovery_connection',wid='legacy_recovery_workflow';
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Existing website','https://example.com/','connected',store.seal({origins:['https://example.com'],access:'public',identity:{kind:'public_origin',origin:'https://example.com'}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Existing action','legacy.recovery','draft','legacy-version',store.seal({inputs:{},steps:[],outputs:[],verifiers:[]}),null,at);
    const connection=()=>store.db.prepare('SELECT * FROM connections WHERE id=?').get(cid),workflow=()=>store.db.prepare('SELECT * FROM workflows WHERE id=?').get(wid),beforeConnection=connection(),beforeWorkflow=workflow();
    const schema=()=>store.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const beforeSchema=schema(),injected=Error('Injected failure after project DDL');let injectedOnce=false;
    const db=new Proxy(store.db,{get(target,key){if(key==='exec')return sql=>{const result=target.exec(sql);if(!injectedOnce&&sql.includes('CREATE TABLE IF NOT EXISTS projects')){injectedOnce=true;throw injected;}return result;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    const app={get(){},post(){}},fail=(code,message,status)=>{throw Object.assign(Error(message),{code,status});};
    assert.throws(()=>installProjects(app,{store:{...store,db},fail}),error=>error===injected);
    assert.equal(injectedOnce,true);assert.deepEqual(schema(),beforeSchema,'rollback removes every new table and index');assert.deepEqual(connection(),beforeConnection);assert.deepEqual(workflow(),beforeWorkflow);
    const installed=installProjects(app,{store,fail}),scope=installed.scope();
    assert.equal(scope.project.id,'project_personal');assert.deepEqual(scope.connections.map(row=>row.id),[cid]);assert.deepEqual(scope.workflows.map(row=>row.id),[wid]);assert.equal(installed.workflowProjectId(wid),'project_personal');
    const afterSchema=schema(),firstDefault=store.db.prepare('SELECT * FROM projects WHERE id=?').get('project_personal');
    installProjects(app,{store,fail});assert.deepEqual(schema(),afterSchema);assert.deepEqual(store.db.prepare('SELECT * FROM projects WHERE id=?').get('project_personal'),firstDefault);assert.equal(store.db.prepare('SELECT count(*) n FROM connection_projects').get().n,1);
    assert.deepEqual(connection(),beforeConnection,'successful retry preserves the original connection ciphertext');assert.deepEqual(workflow(),beforeWorkflow,'successful retry preserves workflow identity, version and ciphertext');
  }finally{store.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
