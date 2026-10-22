import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('owner reliability report uses correlated evidence, scoped periods and sanitized retained metadata',async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4765,state=await createApp({port,dataDir:resolve('work/health-api',randomUUID()),browserEngineFactory:async()=>({isOpen:()=>false,closeAll:async()=>{},closeStudios:async()=>{}})}),{app,store,origin}=state;
  let cookie='',csrf='';
  const call=async(path,body,headers={})=>{const r=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return {status:r.statusCode,value:r.json(),headers:r.headers};};
  const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.value;};
  try{
    assert.equal((await call('/studio/workflows/wf_health/health')).status,401);
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-health-test-owner'})).csrf;
    const at=new Date().toISOString(),cid='conn_health',wid='wf_health',secret='PRIVATE_WEBSITE_VALUE';
    const definition={steps:[],inputs:{},outputs:[{name:'answer',selector:'#private',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}]};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Health fixture',origin+'/sandbox/','connected',store.seal({access:'public',origins:[origin],identity:{kind:'public_origin',origin}}),at);
    for(const id of [wid,'wf_other_health'])store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(id,cid,secret,id,'draft',definition.version,store.seal(definition),null,at);
    const from=new Date(Date.now()-60000).toISOString(),to=new Date(Date.now()+60000).toISOString(),accepted=new Date(Date.now()-10000).toISOString(),started=new Date(Date.now()-9000).toISOString(),observed=new Date(Date.now()-8000).toISOString(),finished=new Date(Date.now()-7000).toISOString();
    const add=(id,status,extra={},workflowId=wid)=>{const payload={run_id:id,input:{secret},result:{secret},workflow_version:definition.version,workflow_revision:1,execution_mode:'managed_local',phase:status,started_at:started,finished_at:finished,execution_ms:2000,steps:[],...extra};store.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(id,workflowId,'fixture',id,'hash',status,store.seal(payload),accepted,finished);};
    add('run_verified_health','succeeded',{outcome:'verified',verification:{run_id:'run_verified_health',verifier_version:definition.version,observed_at:observed,verified_at:finished,checks:['output_schema']}});
    add('run_legacy_health','succeeded');add('run_failed_health','failed',{error:{code:'ELEMENT_NOT_FOUND',message:secret}});add('run_cancelled_health','cancelled');add('run_timeout_health','failed',{error:{code:'WORKFLOW_TIMEOUT'}});add('run_approval_health','failed',{error:{code:'APPROVAL_REJECTED'}});add('run_other_health','failed',{},'wf_other_health');
    const path=`/studio/workflows/${wid}/health?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,report=await ok(path);
    assert.equal(report.counts.invocations,6);assert.equal(report.counts.verified_success,1);assert.equal(report.counts.uncertain,1);assert.equal(report.counts.cancelled,1);assert.equal(report.counts.timed_out,1);assert.equal(report.counts.approval_rejected,1);assert.equal(report.latency.median,2000);assert.equal(report.latency.p95,2000);assert.deepEqual(report.execution_modes,['isolated']);
    assert.equal(JSON.stringify(report).includes(secret),false);assert.equal(JSON.stringify(report).includes('#private'),false);assert.equal(report.recent_executions.length,6);assert.equal(report.retention.history_complete,false);assert.ok(report.warnings.some(value=>value.code==='SMALL_SAMPLE'));
    const downloaded=await call(path+'&download=json');assert.equal(downloaded.headers['content-disposition'],'attachment; filename="hermo-reliability.json"');assert.deepEqual(downloaded.value,report);
    assert.equal((await call(path+'&unexpected=secret')).status,400);assert.equal((await call('/studio/workflows/'+wid+'/health?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z')).status,400);
    const token='hm_live_'+randomBytes(32).toString('base64url');store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_health','Fixture',hash(token),token.slice(-6),wid,new Date(Date.now()+60000).toISOString(),null,at);
    assert.equal((await call(path,undefined,{cookie:'',authorization:'Bearer '+token})).status,401);
    await ok('/studio/settings',{retention_days:30});assert.equal((await ok(path)).retention.days,30);
    add('run_malformed_metadata','failed',{workflow_revision:secret,execution_ms:secret});
    const hardened=await ok(path),malformed=hardened.recent_executions.find(value=>value.id==='run_malformed_metadata');
    assert.equal(malformed.revision,null);assert.equal(malformed.execution_ms,null);assert.equal(JSON.stringify(hardened).includes(secret),false);
    store.db.exec('BEGIN IMMEDIATE');try{for(let index=0;index<9994;index++)add('run_health_limit_'+index,'failed');store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
    const limited=await call(path);assert.equal(limited.status,409);assert.equal(limited.value.error.code,'REPORT_LIMIT');
  }finally{await app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
