import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {verifyResult} from '../server/verification.mjs';

test('publication requires current permission consent and exact breaking-contract acknowledgment without rewriting snapshots',{timeout:15000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_c,definition,input,progress)=>{
    for(let i=0;i<definition.steps.length;i++){progress(i,definition.steps.length);progress(i,definition.steps.length,{phase:'completed'});}
    progress(definition.steps.length,definition.steps.length,{phase:'verifying'});
    const result=Object.fromEntries(definition.outputs.map(field=>[field.name,'Observed']));
    return {result,verification:verifyResult(definition,result,input,'controlled_adapter')};
  }};
  const port=4492,{app,store,origin}=await createApp({port,dataDir:resolve('work/publication-review',randomUUID()),browserEngineFactory:async()=>engine});
  let cookie='',csrf='';
  const call=async(path,body,headers={})=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,'x-hermo-csrf':csrf,...headers},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];return {status:response.statusCode,value:response.json()};};
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const base='/studio/workflows/wf_review',review=()=>ok(base+'/permissions');
  const run=async()=>{const receipt=await ok(base+'/test',{input:{}});for(let n=0;n<100;n++){const result=await ok('/studio/runs/'+receipt.run_id);if(result.status==='succeeded')return result;assert.notEqual(result.status,'failed',JSON.stringify(result));await new Promise(done=>setTimeout(done,20));}assert.fail('Test did not finish');};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-publication-review-password'})).csrf;
    const at=new Date().toISOString(),definition={steps:[],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval'};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_review','Fixture',origin+'/sandbox/review','connected',store.seal({url:origin+'/sandbox/review',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_review','conn_review','Review fixture','review.fixture','draft',definition.version,store.seal(definition),null,at);
    assert.equal((await call(base+'/publish',{})).value.error.code,'TEST_REQUIRED');await run();
    assert.equal((await call(base+'/publish',{})).value.error.code,'PERMISSION_REVIEW_REQUIRED');
    const first=await review();assert.equal((await call(base+'/publish',{expected_version:first.version})).value.error.code,'PERMISSION_REVIEW_REQUIRED');
    assert.equal((await call(base+'/publish',{expected_version:first.version,permission_fingerprint:'stale'})).value.error.code,'PERMISSION_REVIEW_CHANGED');
    const published=await ok(base+'/publish',{expected_version:first.version,permission_fingerprint:first.fingerprint});assert.equal(published.workflow.published_revision,1);
    const original=store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get('wf_review').payload;
    await ok(base+'/draft',{expected_version:first.version});
    const edit=await ok(base+'/editor');
    const changed=await ok(base+'/editor',{expected_version:edit.version,steps:[],inputs:{},outputs:[{name:'response',selector:'#response',type:'string'}],verifiers:[{kind:'nonempty',output:'response'}],timeout_seconds:45});
    await run();const second=await review();assert.equal(second.changes.breaking,true);assert.equal(second.changes.permissions_expanded,true);assert.equal(JSON.stringify(second.changes).includes('#response'),false);
    const consent={expected_version:changed.version,permission_fingerprint:second.fingerprint};
    for(const acknowledgment of [{},{accept_breaking:true},{accept_breaking:true,change_fingerprint:first.fingerprint},{accept_breaking:false,change_fingerprint:second.changes.fingerprint}]){
      const response=await call(base+'/publish',{...consent,...acknowledgment});assert.equal(response.status,409);assert.equal(response.value.error.code,'BREAKING_CONTRACT_REVIEW_REQUIRED');
      assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get('wf_review').revision,1);
    }
    assert.equal((await call(base+'/publish',{...consent,accept_breaking:true,change_fingerprint:second.changes.fingerprint},{cookie:''})).status,401);
    assert.equal((await call(base+'/publish',{...consent,accept_breaking:true,change_fingerprint:second.changes.fingerprint},{'x-hermo-csrf':'wrong'})).status,403);
    const next=await ok(base+'/publish',{...consent,accept_breaking:true,change_fingerprint:second.changes.fingerprint});assert.equal(next.workflow.published_revision,2);
    assert.equal(store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get('wf_review').payload,original);
    const oldKey=await ok('/v1/action-contract',undefined,{authorization:'Bearer '+published.key,cookie:''});assert.deepEqual(Object.keys(oldKey.output_schema.properties),['response'],'active clients receive the explicitly acknowledged replacement');
    const permissions=await ok('/v1/action-permissions',undefined,{authorization:'Bearer '+published.key,cookie:''});assert.doesNotMatch(JSON.stringify(permissions),/#response|#answer|storageState|browser_profile_id/);
    const rollback=await ok(base+'/revision-diff?from=2&to=1');assert.equal(rollback.changes.breaking,true);
    for(const acknowledgment of [{},{change_fingerprint:rollback.changes.fingerprint},{change_fingerprint:'stale',accept_breaking:true,permissions_reviewed:true},{change_fingerprint:rollback.changes.fingerprint,accept_breaking:true}]){
      const response=await call(base+'/rollback',{revision:1,expected_active_revision:2,...acknowledgment});assert.equal(response.value.error.code,'ROLLBACK_REVIEW_REQUIRED');assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get('wf_review').revision,2);
    }
    await ok(base+'/rollback',{revision:1,expected_active_revision:2,change_fingerprint:rollback.changes.fingerprint,accept_breaking:true,permissions_reviewed:true});
    assert.equal((await ok('/v1/action-contract',undefined,{authorization:'Bearer '+published.key,cookie:''})).revision,1);
    assert.equal(store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get('wf_review').payload,original);
  }finally{await app.close();}
});
