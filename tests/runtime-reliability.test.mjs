import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {verifyResult} from '../server/verification.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));
const waitFor=async(check)=>{for(let n=0;n<150;n++){const value=await check();if(value)return value;await pause(20);}assert.fail('Condition did not settle');};

test('runtime serializes requests, reserves recording, preserves receipts and reports truthful phases',{timeout:30000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/runtime-reliability',randomBytes(6).toString('hex')),port=4412;
  let releaseExecution,executionStarted,releaseOpen,operations=0,active=0,maxActive=0;
  let handler=async(_c,d,_input,progress,signal)=>{
    operations++;active++;maxActive=Math.max(active,maxActive);
    try{progress(0,1);executionStarted?.();await new Promise((resolve,reject)=>{releaseExecution=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});progress(0,1,{phase:'completed'});progress(1,1,{phase:'verifying'});await pause(120);return {result:{value:'observed'},verification:verifyResult(d,{value:'observed'},{},'fixture_source'),workflow_version:'adapter_must_not_replace_version',input:{injected:'untrusted'},steps:[]};}finally{active--;}
  };
  const engine={open:async()=>{if(releaseOpen)await releaseOpen;},snapshot:async()=>({can_confirm:true,elements:[],url:'https://fixture.test/'}),isOpen:()=>true,element:()=>({selector:'#button'}),operate:async()=>{throw Error('Owner must not mutate while running');},interact:async()=>{throw Error('Owner must not navigate while running');},allowOrigins:()=>{},close:async()=>{},closeAll:async()=>{},closeStudios:async()=>{},execute:(...args)=>handler(...args)};
  const state=await createApp({port,dataDir,browserEngineFactory:async()=>engine}),{app,store}=state;
  let cookie='',csrf='';
  const call=async(path,body,extra={})=>{
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...extra},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.value;};
  const row=rid=>{const r=store.db.prepare('SELECT * FROM runs WHERE id=?').get(rid);return {...r,...store.unseal(r.payload)};};
  try{
    assert.equal((await call('/health')).value.status,'ok');
    assert.equal((await call('/health',undefined,{origin:'https://evil.test'})).status,403);
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-runtime-owner-password'})).csrf;
    const when=new Date().toISOString(),cid='conn_runtime';
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Fixture','https://fixture.test/','connected',store.seal({url:'https://fixture.test/',checkpoint:'https://fixture.test/',origins:['https://fixture.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://fixture.test'}}),when);
    const definition={version:'version-pinned',inputs:{},outputs:[{name:'value',selector:'#value'}],steps:[{op:'navigate',url:'https://fixture.test/'}],verifiers:[{kind:'nonempty',output:'value'}],effect:'retrieval'};
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_runtime',cid,'Runtime fixture','runtime.fixture','published',definition.version,store.seal(definition),definition.version,when);
    const key='hm_live_'+randomBytes(32).toString('base64url');
    store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_runtime','Fixture key',hash(key),'suffix','wf_runtime','2099-01-01T00:00:00.000Z',null,when);
    const auth={authorization:'Bearer '+key,'idempotency-key':'first'},path='/v1/actions/runtime.fixture/versions/1/runs';
    const started=new Promise(resolve=>executionStarted=resolve),first=await ok(path,{input:{}},auth);await started;
    const second=await ok(path,{input:{}},{...auth,'idempotency-key':'second'});
    assert.equal(row(second.run_id).status,'queued');assert.equal(maxActive,1);
    for(const [url,body]of [[`/studio/recordings`,{connection_id:cid,name:'Conflicting recording',slug:'runtime.other'}],[`/studio/connections/${cid}/interact`,{op:'home'}],[`/studio/connections/${cid}/control`,{element_id:'el',kind:'click'}],[`/studio/connections/${cid}/browser-link`,{authorized:true}],[`/studio/connections/${cid}/open`,{}]]){
      const response=await call(url,body);assert.equal(response.status,409,url);assert.equal(response.value.error.code,'BROWSER_BUSY');
    }
    await ok('/v1/runs/'+first.run_id+'/cancel',{},auth);assert.equal(row(first.run_id).status,'cancelled');assert.equal(row(first.run_id).error.code,'WORKFLOW_CANCELLED');
    await waitFor(()=>row(second.run_id).status==='running');assert.equal(operations,2);assert.equal(maxActive,1,'cancelled execution unwinds before the next job');
    releaseExecution();await waitFor(()=>row(second.run_id).status==='verifying');
    assert.equal(row(second.run_id).result,undefined);await waitFor(()=>row(second.run_id).status==='succeeded');
    const succeeded=await ok('/v1/runs/'+second.run_id,undefined,auth);assert.equal(succeeded.input,undefined);assert.equal(succeeded.steps[0].status,'succeeded');assert.ok(succeeded.started_at&&succeeded.finished_at);assert.equal(succeeded.outcome,'verified');
    assert.equal(succeeded.workflow_version,definition.version);assert.equal(succeeded.verification.run_id,second.run_id);assert.deepEqual(row(second.run_id).input,{});
    const overview=await ok('/studio/overview');assert.equal(overview.runtime.status,'ready');assert.equal(overview.runtime.dashboard_required,false);assert.equal(overview.runtime.concurrency,1);assert.ok(overview.runtime.authorization_expires_at);
    await ok(`/studio/connections/${cid}/stop`,{});
    assert.equal((await ok(path,{input:{}},auth)).run_id,first.run_id,'accepted idempotent receipt survives browser Stop');
    assert.equal((await call(path,{input:{}},{...auth,'idempotency-key':'new-after-stop'})).value.error.code,'CONNECTION_STOPPED');
    store.db.prepare("UPDATE connections SET status='connected' WHERE id=?").run(cid);
    let release;releaseOpen=new Promise(resolve=>release=resolve);
    const recordingStart=call('/studio/recordings',{connection_id:cid,name:'Read fixture',slug:'record.fixture',action_type:'read'});
    await pause(50);assert.equal((await call(path,{input:{}},{...auth,'idempotency-key':'during-recording-start'})).value.error.code,'RECORDING_ACTIVE');
    assert.equal((await call('/studio/recordings',{connection_id:cid,name:'Other',slug:'other.fixture'})).value.error.code,'RECORDING_ACTIVE');
    release();const recording=(await recordingStart).value;
    assert.equal((await call(path,{input:{}},{...auth,'idempotency-key':'during-recording'})).value.error.code,'RECORDING_ACTIVE');
    await ok('/studio/recordings/'+recording.id+'/discard',{});releaseOpen=undefined;
    handler=async()=>{throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:'value',reason:'missing_output',text:'DO_NOT_LOG_SECRET'}});};
    const bad=await ok(path,{input:{}},{...auth,'idempotency-key':'missing'});await waitFor(()=>row(bad.run_id).status==='failed');
    assert.equal(row(bad.run_id).error.category,'OUTPUT_VALIDATION_FAILED');assert.equal(row(bad.run_id).result,undefined);assert.equal(JSON.stringify(row(bad.run_id)).includes('DO_NOT_LOG_SECRET'),false);
    for(const [name,value]of [['wrong-type',{result:{value:42}}],['missing-evidence',{result:{value:'observed'}}],['wrong-version',{result:{value:'observed'},verification:{verified_at:new Date().toISOString(),verifier_version:'another-version',checks:['source']}}]]){
      handler=async(_c,d,_input,progress)=>{progress(0,1);progress(0,1,{phase:'completed'});progress(1,1,{phase:'verifying'});return value;};
      const receipt=await ok(path,{input:{}},{...auth,'idempotency-key':name});await waitFor(()=>row(receipt.run_id).status==='failed');
      assert.equal(row(receipt.run_id).result,undefined);assert.equal(row(receipt.run_id).error.category,'OUTPUT_VALIDATION_FAILED');
    }
    handler=async(_c,d,input,progress)=>{progress(0,1);progress(0,1,{phase:'completed'});return {result:{value:'observed'},verification:verifyResult(d,{value:'observed'},input,'fixture_source')};};
    const finalized=await ok(path,{input:{}},{...auth,'idempotency-key':'runtime-owned-verifying-phase'});await waitFor(()=>row(finalized.run_id).status==='succeeded');
    assert.equal(row(finalized.run_id).steps[0].status,'succeeded');assert.equal(row(finalized.run_id).verification.status,'passed');
  }finally{releaseExecution?.();await app.close();}
});
