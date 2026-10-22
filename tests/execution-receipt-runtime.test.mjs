import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {verifyResult} from '../server/verification.mjs';

test('REST and MCP receipts expose canonical outcomes, scoped ownership and current-invocation evidence',{timeout:30000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  let behavior='success';
  // Adapter fixture exercises the actual admission/worker/persistence/protocol
  // path. Separate completion-evidence suites exercise the real browser DOM.
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_c,d,input,progress,signal)=>{
    progress(0,1);
    if(behavior==='timeout')throw Error('TIMEOUT');
    if(behavior==='uncertain'||behavior==='cancel')progress(0,1,{phase:'issuing'});
    if(behavior==='uncertain')throw Error('TIMEOUT');
    if(behavior==='cancel')await new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});if(signal.aborted)reject(signal.reason);});
    progress(0,1,{phase:'completed'});progress(1,1,{phase:'verifying'});
    const verification=verifyResult(d,{answer:'Same answer'},input,'fixture_source');
    if(behavior==='stale')verification.observed_at='2000-01-01T00:00:00.000Z';
    return {result:{answer:'Same answer'},verification};
  }};
  const port=4491,{app,store}=await createApp({port,dataDir:resolve('work/execution-receipt',randomUUID()),browserEngineFactory:async()=>engine});
  const secret='hm_live_'+randomBytes(32).toString('base64url'),other='hm_live_'+randomBytes(32).toString('base64url');
  let cookie='',csrf='';
  const call=async(path,body,key)=>{
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,...key?{authorization:'Bearer '+key}:{cookie,'x-hermo-csrf':csrf},accept:'application/json, text/event-stream',...path==='/mcp'?{'mcp-protocol-version':'2025-11-25'}:{},...body===undefined?{}:{'idempotency-key':randomUUID()}},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const poll=async(id,terminal=true)=>{for(let n=0;n<300;n++){const run=await ok('/v1/runs/'+id,undefined,secret);if(terminal?!['queued','running','verifying'].includes(run.status):run.steps?.[0]?.status==='running')return run;await new Promise(done=>setTimeout(done,20));}assert.fail('run did not reach expected state');};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-receipt-owner-password'})).csrf;
    const at=new Date().toISOString(),definition={version:'receipt-definition',effect:'retrieval',inputs:{},steps:[{op:'click',selector:'#search'}],outputs:[{name:'answer',selector:'#answer'}],verifiers:[{kind:'nonempty',output:'answer'}]};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_receipt','Fixture','https://example.test/','connected',store.seal({url:'https://example.test/',origins:['https://example.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://example.test'}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_receipt','conn_receipt','Receipt fixture','receipt.fixture','published',definition.version,store.seal(definition),definition.version,at);
    for(const [id,key]of [['key_receipt',secret],['key_other',other]])store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run(id,'Synthetic',hash(key),'suffix','wf_receipt','2099-01-01T00:00:00Z',null,at);
    const start=async()=>ok('/v1/actions/receipt.fixture/versions/1/runs',{input:{}},secret);
    let previous;
    for(let i=0;i<2;i++){
      const accepted=await start(),run=await poll(accepted.run_id),receipt=await ok('/v1/runs/'+run.id+'/receipt',undefined,secret);
      assert.equal(run.status,'succeeded');assert.equal(run.execution_status,'succeeded');assert.equal(receipt.execution_id,run.id);assert.notEqual(receipt.execution_id,previous);previous=receipt.execution_id;
      assert.deepEqual(receipt.output,{answer:'Same answer'});assert.equal(receipt.published_version.revision,1);assert.ok(receipt.verification.observed_at>=run.steps[0].finished_at);
      assert.equal((await call('/v1/runs/'+run.id+'/receipt',undefined,other)).status,404);
      assert.equal((await call('/v1/runs/'+run.id+'/receipt')).status,401);
      const mcp=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_execution_receipt',arguments:{run_id:run.id}}},secret);
      assert.deepEqual(mcp.result.structuredContent,receipt);
    }
    for(const [mode,expected]of [['timeout','timed_out'],['uncertain','uncertain'],['stale','failed']]){
      behavior=mode;const run=await poll((await start()).run_id),receipt=await ok('/v1/runs/'+run.id+'/receipt',undefined,secret);
      assert.equal(run.status,'failed','legacy polling terminates');assert.equal(run.execution_status,expected);assert.equal(run.phase,expected);assert.equal(receipt.status,expected);assert.equal(receipt.output,undefined);assert.equal(run.result,undefined);
      if(mode==='uncertain'){assert.equal(receipt.diagnostics.retry_safe,false);assert.equal(run.error.code,'EXECUTION_OUTCOME_UNKNOWN');}
      if(mode==='stale')assert.equal(run.error.verification.reason,'invalid_evidence');
    }
    behavior='cancel';const pending=await start();await poll(pending.run_id,false);const cancelled=await ok('/v1/runs/'+pending.run_id+'/cancel',{},secret);assert.equal(cancelled.execution_status,'cancelled');assert.equal(cancelled.error.retry_safe,false);assert.equal(cancelled.result,undefined);
    const tools=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},secret),action=tools.result.tools.find(tool=>tool.name==='action_receipt_fixture');
    assert.equal(action.annotations.readOnlyHint,false,'managed DOM actions are not guaranteed read-only');assert.equal(action.annotations.idempotentHint,false);
  }finally{await app.close();}
});
