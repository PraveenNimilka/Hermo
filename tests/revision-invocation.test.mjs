import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {verifyResult} from '../server/verification.mjs';
import {convertOutputs} from '../server/workflow-contract.mjs';

// Real authorization, encrypted storage, publication and scheduling with a
// deterministic browser boundary. This does not claim live website coverage.
test('explicit published revisions retain immutable REST/MCP contracts and execution authority',{timeout:45000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));
  const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const dataDir=resolve('work/revision-invocation',randomUUID()),executed=[];
  const engine={isOpen:()=>true,open:async()=>{},close:async()=>{},closeAll:async()=>{},closeStudios:async()=>{},allowOrigins:()=>{},execute:async(connection,definition,input,progress)=>{
    executed.push({version:definition.version,origins:[...connection.origins]});
    progress(0,1);progress(0,1,{phase:'completed'});progress(1,1,{phase:'verifying'});
    const raw={value:String(input.quantity)};
    return {result:convertOutputs(definition.outputs,raw),verification:verifyResult(definition,raw,input,'controlled_revision_adapter')};
  }};
  let state=await createApp({port,dataDir,browserEngineFactory:async()=>engine}),{app,store}=state,cookie='',csrf='';
  const call=async(path,body,headers={})=>{
    const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  // This fixture owner explicitly reviews and authorizes configured rollback changes.
  const ok=async(...args)=>{if(args[1]!==undefined&&/^\/studio\/workflows\/[^/]+\/rollback$/.test(args[0])){const base=args[0].replace(/\/rollback$/,''),history=await ok(base+'/revisions'),review=await ok(base+'/revision-diff?from='+history.active_revision+'&to='+args[1].revision);args[1]={...(review.changes?{change_fingerprint:review.changes.fingerprint,accept_breaking:true,permissions_reviewed:true}:{}),...args[1]};}const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const ownerPublish=async base=>{
    const review=await ok(base+'/permissions');
    // This fixture owner explicitly reviews and authorizes its contract changes.
    return ok(base+'/publish',{expected_version:review.version,permission_fingerprint:review.fingerprint,...review.changes?.breaking?{change_fingerprint:review.changes.fingerprint,accept_breaking:true}:{}});
  };
  const finish=async id=>{
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){const run=await ok('/studio/runs/'+id);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(done=>setTimeout(done,20));}
    assert.fail('Controlled revision execution did not finish');
  };
  const mcpHeaders=auth=>({...auth,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});
  let rpcId=0;
  const rpc=async(name,args,auth)=>{
    const response=await ok('/mcp',{jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}},mcpHeaders(auth));
    assert.equal(response.result?.isError,undefined,JSON.stringify(response));return response.result.structuredContent;
  };
  const wid='wf_historical',base='/studio/workflows/'+wid,slug='revision.explicit',activeEndpoint='/v1/actions/'+slug+'/versions/1/runs';
  const endpoint=number=>`/v1/actions/${slug}/revisions/${number}/runs`;
  const submit=(path,requestId,auth,input={})=>ok(path,{input},{...auth,'idempotency-key':requestId});
  let key,auth;
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-explicit-revision-owner'})).csrf;
    const when=new Date().toISOString(),cid='conn_historical',config={url:'https://fixture.test/',origins:['https://fixture.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://fixture.test'}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Historical revision fixture',config.url,'connected',store.seal(config),when);
    function seed(id,action){
      const definition={contract_version:'2',inputs:{quantity:{type:'string',required:false,default:'11'}},outputs:[{name:'value',selector:'#result',type:'number',required:true}],steps:[{op:'navigate',url:config.url}],verifiers:[{kind:'nonempty',output:'value'}],effect:'retrieval'};
      definition.version=hash(JSON.stringify(definition));
      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(id,cid,action,action,'draft',definition.version,store.seal(definition),null,when);return definition;
    }
    const firstDefinition=seed(wid,slug);
    assert.equal((await finish((await ok(base+'/test',{input:{}})).run_id)).status,'succeeded');
    key=await ownerPublish(base);auth={authorization:'Bearer '+key.key,cookie:''};
    const original=await submit(activeEndpoint,'recover-active-before-publication',auth);assert.deepEqual((await finish(original.run_id)).result,{value:11});
    await ok(base+'/draft',{expected_version:firstDefinition.version});
    const draft=(await ok(base+'/contract',{expected_version:firstDefinition.version,inputs:{quantity:{type:'string',required:false,default:'22'}},outputs:[{name:'value',type:'string'}]})).workflow;
    assert.equal((await finish((await ok(base+'/test',{input:{}})).run_id)).status,'succeeded');
    const publication2=await ownerPublish(base);assert.equal(publication2.workflow.published_revision,2);
    await t.test('historical REST contracts and invocation select frozen schemas rather than current defaults',async()=>{
      const listed=await ok('/v1/action-revisions',undefined,auth);assert.equal(listed.active_revision,2);
      assert.deepEqual(listed.revisions.map(item=>item.revision).sort(),[1,2]);assert.equal(listed.revisions.find(item=>item.revision===2).active,true);
      assert.equal(JSON.stringify(listed).includes('#result'),false);assert.equal(JSON.stringify(listed).includes('fixture.test'),false);assert.equal(JSON.stringify(listed).includes(key.key),false);
      const one=await ok('/v1/action-contract?revision=1',undefined,auth),two=await ok('/v1/action-contract?revision=2',undefined,auth);
      assert.equal(one.revision,1);assert.equal(two.revision,2);assert.equal(one.input_schema.properties.quantity.default,'11');assert.equal(two.input_schema.properties.quantity.default,'22');
      assert.equal(one.output_schema.properties.value.type,'number');assert.equal(two.output_schema.properties.value.type,'string');assert.notEqual(one.version,two.version);
      const old=await finish((await submit(endpoint(1),'explicit-old-rest',auth)).run_id),current=await finish((await submit(endpoint(2),'explicit-current-rest',auth)).run_id);
      assert.equal(old.status,'succeeded');assert.equal(current.status,'succeeded');assert.deepEqual(old.result,{value:11});assert.deepEqual(current.result,{value:'22'});
      assert.equal(old.workflow_revision,1);assert.equal(current.workflow_revision,2);assert.equal(old.workflow_version,firstDefinition.version);assert.equal(current.workflow_version,draft.version);
      const before=executed.length;
      assert.equal((await submit(endpoint(1),'explicit-old-rest',auth)).run_id,old.id);
      const conflict=await call(endpoint(2),{input:{}},{...auth,'idempotency-key':'explicit-old-rest'});assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_REVISION_CONFLICT');assert.equal(executed.length,before);
      const recovered=await submit(activeEndpoint,'recover-active-before-publication',auth);assert.equal(recovered.run_id,original.run_id);assert.equal(recovered.reused,true);
      assert.equal((await call(endpoint(999),{input:{}},{...auth,'idempotency-key':'missing-revision'})).status,404);
    });
    await t.test('MCP historical introspection and invocation match REST while keeping the current action schema',async()=>{
      const tools=await ok('/mcp',{jsonrpc:'2.0',id:++rpcId,method:'tools/list',params:{}},mcpHeaders(auth));
      assert.ok(tools.result.tools.find(item=>item.name==='invoke_revision'));
      assert.equal(tools.result.tools.find(item=>item.name==='action_revision_explicit').inputSchema.properties.revision,undefined);
      for(const number of [1,2]){
        const rest=await ok('/v1/action-contract?revision='+number,undefined,auth),contract=await rpc('get_contract',{revision:number},auth);
        assert.equal(contract.revision,number);assert.equal(contract.version,rest.version);assert.deepEqual(contract.input_schema,rest.input_schema);assert.deepEqual(contract.output_schema,rest.output_schema);
        const receipt=await rpc('invoke_revision',{revision:number,input:{},request_id:'explicit-mcp-'+number},auth),run=await finish(receipt.run_id);
        assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.workflow_revision,number);assert.deepEqual(run.result,{value:number===1?11:'22'});
      }
    });
    await t.test('rollback changes only the active pointer; historical invocation survives runtime restart',async()=>{
      await ok(base+'/rollback',{revision:1,expected_active_revision:2});
      assert.equal((await ok('/v1/action-revisions',undefined,auth)).active_revision,1);
      assert.deepEqual((await finish((await submit(activeEndpoint,'after-rollback-active',auth)).run_id)).result,{value:11});
      assert.deepEqual((await finish((await submit(endpoint(2),'after-rollback-explicit-two',auth)).run_id)).result,{value:'22'});
      await app.close();state=await createApp({port,dataDir,browserEngineFactory:async()=>engine});({app,store}=state);cookie='';csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/login',{password:'synthetic-explicit-revision-owner'})).csrf;
      assert.equal((await ok('/v1/action-revisions',undefined,auth)).active_revision,1);
      assert.deepEqual((await finish((await submit(endpoint(2),'after-restart-explicit-two',auth)).run_id)).result,{value:'22'});
      assert.equal((await ok('/v1/action-contract?revision=2',undefined,auth)).output_schema.properties.value.type,'string');
    });
    await t.test('workflow scope, revision proof, frozen browser authority, pause and key revocation remain enforced',async()=>{
      const otherId='wf_other_historical',otherBase='/studio/workflows/'+otherId;seed(otherId,'revision.other');
      assert.equal((await finish((await ok(otherBase+'/test',{input:{}})).run_id)).status,'succeeded');const other=await ownerPublish(otherBase),foreign={authorization:'Bearer '+other.key,cookie:''};
      assert.equal((await call(endpoint(1),{input:{}},{...foreign,'idempotency-key':'wrong-scope'})).status,403);
      assert.equal((await call('/v1/actions/revision.other/revisions/1/runs',{input:{}},{...auth,'idempotency-key':'wrong-slug'})).status,403);
      const originalRevision=store.db.prepare('SELECT * FROM workflow_revisions WHERE workflow_id=? AND revision=2').get(wid),unverified=store.unseal(originalRevision.payload);
      unverified.proof={kind:'legacy_unverified'};
      store.db.prepare('INSERT INTO workflow_revisions (workflow_id,revision,version,test_version,payload,created_at,execution_mode,proof_hash) VALUES (?,?,?,?,?,?,?,?)').run(wid,3,originalRevision.version,null,store.seal(unverified),new Date().toISOString(),originalRevision.execution_mode,originalRevision.proof_hash);
      const before=executed.length,blocked=await call(endpoint(3),{input:{}},{...auth,'idempotency-key':'unverified-revision'});assert.ok([404,409].includes(blocked.status),JSON.stringify(blocked));assert.equal(executed.length,before);
      const connectionRow=store.db.prepare('SELECT payload FROM connections WHERE id=?').get(cid),changed=store.unseal(connectionRow.payload);
      store.db.prepare('UPDATE connections SET payload=? WHERE id=?').run(store.seal({...changed,origins:['https://different.test']}),cid);
      const invalidAuthority=await call(endpoint(1),{input:{}},{...auth,'idempotency-key':'changed-browser-scope'});assert.equal(invalidAuthority.status,409);assert.equal(executed.length,before);
      store.db.prepare('UPDATE connections SET payload=? WHERE id=?').run(connectionRow.payload,cid);
      await ok(base+'/pause',{});assert.equal((await call(endpoint(2),{input:{}},{...auth,'idempotency-key':'paused-history'})).status,409);assert.equal(executed.length,before);
      await ok(base+'/rollback',{revision:1,expected_active_revision:1});
      await ok('/studio/keys/'+key.id+'/revoke',{});assert.equal((await call(endpoint(1),{input:{}},{...auth,'idempotency-key':'revoked-history'})).status,401);
      assert.equal((await call('/v1/action-revisions',undefined,auth)).status,401);
    });
  }finally{await app.close();}
});
