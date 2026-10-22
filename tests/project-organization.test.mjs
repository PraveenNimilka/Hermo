import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('project metadata, independent action organization and archive preserve contracts and scoped history',async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4449,{app,store,origin}=await createApp({port,dataDir:resolve('work/project-organization',randomUUID())});let cookie='',csrf='';
  const call=async(path,body,headers={})=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,'x-hermo-csrf':csrf,...headers},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return {status:r.statusCode,value:r.json()};};
  const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.value;};
  try{
    assert.equal((await call('/studio/projects')).status,401);csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-project-organization-owner'})).csrf;
    const p=(await ok('/studio/projects',{name:'Research',description:'Private project notes'})).project,q=(await ok('/studio/projects',{name:'Operations'})).project;
    assert.equal(p.description,'Private project notes');assert.equal(p.archived,false);assert.doesNotMatch(store.db.prepare('SELECT payload FROM project_metadata WHERE project_id=?').get(p.id).payload,/Private project notes/);
    assert.equal((await call(`/studio/projects/${p.id}/metadata`,{description:'blocked'},{'x-hermo-csrf':'wrong'})).status,403);
    assert.equal((await call(`/studio/projects/${p.id}/archive`,{archived:true},{cookie:''})).status,401);
    const source=(await ok('/studio/connections',{name:'Source',url:origin+'/sandbox/',authorized:true})).connection;
    const target=(await ok('/studio/connections',{name:'Execution browser',url:origin+'/sandbox/',authorized:true})).connection;
    const wid='wf_project_organization',at=new Date().toISOString(),definition={inputs:{},steps:[],outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',execution_connection_id:target.id};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,source.id,'Project action','project.organized','draft',definition.version,store.seal(definition),null,at);
    store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('project_key','Fixture key',hash('synthetic-project-consumer'),'umer',wid,'2099-01-01T00:00:00.000Z',null,at);
    const run={phase:'succeeded',outcome:'verified',result:{answer:'private output'},workflow_version:definition.version,started_at:at,finished_at:at,steps:[],verification:{run_id:'project_run',verifier_version:definition.version,observed_at:at,verified_at:at,checks:['nonempty_outputs']}};
    const insertRun=(rid,status,payload)=>store.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(rid,wid,'project_key',rid,hash(rid),status,store.seal(payload),at,at);
    insertRun('project_run','succeeded',run);insertRun('project_unproven','succeeded',{result:{answer:'not evidence'}});
    const before={workflow:store.db.prepare('SELECT * FROM workflows WHERE id=?').get(wid),key:store.db.prepare('SELECT * FROM api_keys WHERE id=?').get('project_key'),run:store.db.prepare('SELECT * FROM runs WHERE id=?').get('project_run')};
    await ok(`/studio/workflows/${wid}/project`,{project_id:p.id});
    let scope=await ok('/studio/overview?project_id='+p.id);assert.equal(scope.workflows[0].id,wid);assert.equal(scope.workflows[0].project_id,p.id);assert.deepEqual(new Set(scope.connections.map(c=>c.id)),new Set([source.id,target.id]));assert.equal(scope.keys[0].id,'project_key');assert.equal(scope.runs.length,2);
    assert.equal((await ok('/studio/overview')).workflows.length,0);
    let listed=(await ok('/studio/projects?q=private&sort=name')).projects;assert.deepEqual(listed.map(x=>x.id),[p.id]);assert.equal(listed[0].health.verified,1);assert.equal(listed[0].health.uncertain,1);assert.equal(listed[0].health.sample_size,2);assert.doesNotMatch(JSON.stringify(listed),/private output|synthetic-project-consumer/);
    await ok(`/studio/projects/${p.id}/archive`,{archived:true});assert.equal((await ok('/studio/projects?archived=archived')).projects[0].id,p.id);
    assert.equal((await call(`/studio/workflows/${wid}/project`,{project_id:p.id})).value.error.code,'PROJECT_ARCHIVED');
    assert.equal((await call('/studio/connections',{name:'Not created',url:origin+'/sandbox/',project_id:p.id,authorized:true})).value.error.code,'PROJECT_ARCHIVED');
    assert.equal(store.db.prepare('SELECT count(*) n FROM connections').get().n,2,'archived project creation fails before resource insertion');
    scope=await ok('/studio/overview?project_id='+p.id);assert.equal(scope.workflows[0].id,wid,'archive keeps history browsable');
    assert.deepEqual(store.db.prepare('SELECT * FROM workflows WHERE id=?').get(wid),before.workflow);assert.deepEqual(store.db.prepare('SELECT * FROM api_keys WHERE id=?').get('project_key'),before.key);assert.deepEqual(store.db.prepare('SELECT * FROM runs WHERE id=?').get('project_run'),before.run);
    assert.equal((await call(`/studio/projects/${p.id}/remove`,{confirmation:'Delete "Research"'})).value.error.code,'PROJECT_NOT_EMPTY');
    await ok(`/studio/projects/${p.id}/archive`,{archived:false});await ok(`/studio/projects/${p.id}/metadata`,{description:'Updated description'});await ok(`/studio/connections/${source.id}/project`,{project_id:q.id});
    assert.equal((await ok('/studio/overview?project_id='+p.id)).workflows[0].id,wid,'explicit assignment does not follow later connection moves');
    await ok(`/studio/workflows/${wid}/project`,{project_id:q.id});await ok(`/studio/projects/${p.id}/remove`,{confirmation:'Delete "Research"'});
    assert.equal((await ok('/studio/overview?project_id='+q.id)).workflows[0].id,wid);assert.equal((await call('/studio/projects?q=x&unexpected=1')).status,400);
  }finally{await app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});



test('legacy resources migrate into the default project and a moved, archived API remains invocable',{timeout:15000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const {openStore}=await import('../server/store.mjs'),{verifyResult}=await import('../server/verification.mjs');
  const directory=resolve('work/project-organization-migration',randomUUID()),port=4450,origin=`http://127.0.0.1:${port}`,at=new Date().toISOString();
  const old=openStore(directory),definition={steps:[],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval'};definition.version=hash(JSON.stringify(definition));
  old.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('project_legacy_connection','Legacy connection',origin+'/sandbox/','connected',old.seal({url:origin+'/sandbox/',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
  old.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('project_legacy_workflow','project_legacy_connection','Legacy action','project.legacy','draft',definition.version,old.seal(definition),null,at);old.close();
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_c,d,input,progress)=>{progress(0,0,{phase:'verifying'});const result={answer:'Controlled observation'};return {result,verification:verifyResult(d,result,input,'controlled_adapter')};}};
  const {app,store}=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});let cookie='',csrf='';
  const call=async(path,body,headers={})=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,'x-hermo-csrf':csrf,...headers},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];assert.ok(r.statusCode<300,r.body);return r.json();};
  const terminal=async rid=>{for(let n=0;n<100;n++){const r=await call('/studio/runs/'+rid);if(['succeeded','failed','cancelled'].includes(r.status)){assert.equal(r.status,'succeeded',JSON.stringify(r));return r;}await new Promise(done=>setTimeout(done,20));}assert.fail('Run did not finish');};
  try{
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-project-migration-owner'})).csrf;
    assert.equal((await call('/studio/overview')).workflows[0].id,'project_legacy_workflow');
    const base='/studio/workflows/project_legacy_workflow';await terminal((await call(base+'/test',{input:{}})).run_id);const review=await call(base+'/permissions'),published=await call(base+'/publish',{expected_version:review.version,permission_fingerprint:review.fingerprint});
    const revisions=store.db.prepare('SELECT * FROM workflow_revisions WHERE workflow_id=?').all('project_legacy_workflow'),key=store.db.prepare('SELECT * FROM api_keys WHERE workflow_id=?').get('project_legacy_workflow'),workflow=store.db.prepare('SELECT * FROM workflows WHERE id=?').get('project_legacy_workflow');
    const project=(await call('/studio/projects',{name:'Migrated APIs'})).project;await call(base+'/project',{project_id:project.id});await call(`/studio/projects/${project.id}/archive`,{archived:true});
    assert.equal((await call('/studio/projects?q=Migrated')).projects[0].api_count,1);
    const accepted=await call('/v1/actions/project.legacy/versions/1/runs',{input:{}},{authorization:'Bearer '+published.key,cookie:'','idempotency-key':'project-migration-api'});const run=await terminal(accepted.run_id);assert.equal(run.result.answer,'Controlled observation');
    assert.deepEqual(store.db.prepare('SELECT * FROM workflow_revisions WHERE workflow_id=?').all('project_legacy_workflow'),revisions);assert.deepEqual(store.db.prepare('SELECT * FROM api_keys WHERE workflow_id=?').get('project_legacy_workflow'),key);assert.deepEqual(store.db.prepare('SELECT * FROM workflows WHERE id=?').get('project_legacy_workflow'),workflow);
  }finally{await app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
