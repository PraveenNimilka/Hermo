import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {verifyResult} from '../server/verification.mjs';
import {convertOutputs} from '../server/workflow-contract.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check){for(let n=0;n<250;n++){const value=await check();if(value)return value;await pause(20);}assert.fail('Condition did not settle');}

// Real admission/storage/queue/auth/verification, controlled browser boundary.
// Browser compatibility is covered separately by the actual Chrome suites.
test('published revisions isolate drafts, pin queued runs, preserve key scopes and roll back',{timeout:30000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4426,dataDir=resolve('work/revision-runtime',randomBytes(6).toString('hex'));
  let release,blocked=false;
  const executed=[];
  const engine={isOpen:()=>true,open:async()=>{},close:async()=>{},closeAll:async()=>{},closeStudios:async()=>{},allowOrigins:()=>{},execute:async(c,d,input,progress,signal)=>{
    executed.push({version:d.version,origins:c.origins});progress(0,1);
    if(blocked){await new Promise((done,reject)=>{release=done;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});blocked=false;}
    progress(0,1,{phase:'completed'});progress(1,1,{phase:'verifying'});
    const raw={value:String(input.quantity)};
    return {result:convertOutputs(d.outputs,raw),verification:verifyResult(d,raw,input,'fixture_source')};
  }};
  let state=await createApp({port,dataDir,browserEngineFactory:async()=>engine}),{app,store}=state;
  let cookie='',csrf='';
  const call=async(path,body,extra={})=>{
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...extra},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const finish=rid=>until(async()=>{const run=await ok('/studio/runs/'+rid);return ['succeeded','failed','cancelled'].includes(run.status)?run:null;});
  const wid='wf_revision',base=`/studio/workflows/${wid}`,endpoint='/v1/actions/revision.fixture/versions/1/runs';
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-revision-owner-password'})).csrf;
    const when=new Date().toISOString();
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_revision','Revision fixture','https://fixture.test/','connected',store.seal({url:'https://fixture.test/',origins:['https://fixture.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://fixture.test'}}),when);
    const definition={contract_version:'2',inputs:{quantity:{type:'number',required:false,default:1}},outputs:[{name:'value',selector:'#result',type:'number',required:true}],steps:[{op:'navigate',url:'https://fixture.test/'}],verifiers:[{kind:'equals_input',output:'value',input:'quantity'}],effect:'retrieval'};
    definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,'conn_revision','Revision fixture','revision.fixture','draft',definition.version,store.seal(definition),null,when);
    assert.equal((await call(base+'/publish',{})).value.error.code,'TEST_REQUIRED');
    assert.equal((await finish((await ok(base+'/test',{input:{}})).run_id)).status,'succeeded');
    const first=await ok(base+'/publish',{}),auth={authorization:'Bearer '+first.key};
    assert.equal(first.workflow.published_revision,1);
    const history=await ok(base+'/revisions');assert.equal(history.active_revision,1);
    assert.equal(history.revisions.length,1);assert.equal(JSON.stringify(history).includes('#result'),false);
    assert.equal((await call(base+'/draft',{expected_version:'stale'})).value.error.code,'VERSION_CHANGED');
    assert.equal((await call(base+'/draft',{expected_version:definition.version},{'x-hermo-csrf':'bad'})).status,403);
    let draft=(await ok(base+'/draft',{expected_version:definition.version})).workflow;
    assert.equal(draft.draft_open,true);assert.equal(draft.tested,false);
    const edit={expected_version:draft.version,inputs:{quantity:{type:'number',required:false,default:2}},outputs:[{name:'value',type:'number'}]};
    draft=(await ok(base+'/contract',edit)).workflow;
    assert.equal(draft.status,'published');assert.equal(draft.has_draft_changes,true);
    assert.equal((await ok('/v1/action-contract',undefined,auth)).input_schema.properties.quantity.default,1);
    const spec=await ok(base+'/openapi');assert.equal(spec.paths[endpoint].post.requestBody.content['application/json'].schema.properties.input.properties.quantity.default,1);assert.deepEqual(spec.paths[endpoint].post.requestBody.content['application/json'].schema.properties.expected_revision.type,'integer');
    assert.equal((await call(base+'/publish',{})).value.error.code,'TEST_REQUIRED');
    const old=await finish((await ok(endpoint,{input:{}},{...auth,'idempotency-key':'old-default'})).run_id);
    assert.deepEqual(old.result,{value:1});assert.equal(old.workflow_revision,1);assert.equal(old.workflow_version,definition.version);
    assert.equal((await finish((await ok(base+'/test',{input:{}})).run_id)).result.value,2);

    // Two accepted requests must retain revision 1 through a new publication.
    blocked=true;
    const active=await ok(endpoint,{input:{}},{...auth,'idempotency-key':'active-old'});await until(()=>release);
    const queued=await ok(endpoint,{input:{}},{...auth,'idempotency-key':'queued-old'});
    const second=await ok(base+'/publish',{});assert.equal(second.workflow.published_revision,2);
    release();assert.equal((await finish(active.run_id)).workflow_revision,1);
    const pinned=await finish(queued.run_id);assert.equal(pinned.status,'succeeded',JSON.stringify(pinned));assert.equal(pinned.workflow_revision,1);assert.equal(pinned.result.value,1);
    const fresh=await finish((await ok(endpoint,{input:{}},{...auth,'idempotency-key':'new-default'})).run_id);
    assert.equal(fresh.workflow_revision,2);assert.equal(fresh.result.value,2);
    assert.equal((await call(endpoint,{input:{},expected_revision:1},{...auth,'idempotency-key':'stale-new-request'})).value.error.code,'VERSION_CHANGED');
    assert.equal((await ok(endpoint,{input:{},expected_revision:1},{...auth,'idempotency-key':'old-default'})).run_id,old.id,'receipt is not resubmitted under new defaults');
    assert.equal((await call('/v1/actions/not.allowed/versions/1/runs',{input:{}},{...auth,'idempotency-key':'scope'})).status,403);
    assert.equal((await call(base+'/rollback',{revision:1,expected_active_revision:1})).value.error.code,'VERSION_CHANGED');
    await ok(base+'/rollback',{revision:1,expected_active_revision:2});
    assert.equal((await finish((await ok(endpoint,{input:{}},{...auth,'idempotency-key':'rollback'})).run_id)).result.value,1);
    const restored=(await ok(base+'/draft',{revision:1,expected_version:draft.version})).workflow;
    assert.equal(restored.version,definition.version);assert.equal(restored.tested,false);
    assert.equal((await ok(base+'/revisions')).revisions.length,2);
    assert.equal(store.db.prepare('SELECT count(*) n FROM workflow_revisions').get().n,2);
    assert.throws(()=>store.db.prepare("UPDATE workflow_revisions SET version='forged'").run(),/immutable/);
    await app.close();
    state=await createApp({port,dataDir,browserEngineFactory:async()=>engine});({app,store}=state);
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/login',{password:'synthetic-revision-owner-password'})).csrf;
    assert.equal((await ok(base+'/revisions')).active_revision,1);
    assert.equal((await ok('/v1/runs/'+fresh.id,undefined,auth)).workflow_revision,2,'history survives rollback and restart unchanged');
    assert.equal((await finish((await ok(endpoint,{input:{}},{...auth,'idempotency-key':'restart'})).run_id)).result.value,1);
    const key=store.db.prepare('SELECT id FROM api_keys WHERE hash=?').get(hash(first.key));
    await ok(`/studio/keys/${key.id}/revoke`,{});
    assert.equal((await call(endpoint,{input:{}},{...auth,'idempotency-key':'revoked'})).status,401);
    assert.ok(executed.length>=8);
  }finally{release?.();await app.close();}
});
