import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('permission review and owner checkpoints protect the real REST/MCP execution path',{timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));
  const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const {app,origin,store}=await createApp({port,dataDir:resolve('work/workflow-safety',randomUUID())});
  let submissions=0,cookie='',csrf='',targetDelay=0;
  app.get('/sandbox/approval',async(_,reply)=>reply.type('text/html').send(`<!doctype html><title>Approval fixture</title><p id="lookup">Lookup ready</p><button id="submit" aria-label="Submit record" ${targetDelay?'disabled':''}>Submit record</button><p id="result">Waiting</p><script src="/sandbox/approval-fixture.js"></script>`));
  app.get('/sandbox/approval-fixture.js',async(_,reply)=>reply.type('text/javascript').send(`setTimeout(()=>document.querySelector('#submit').disabled=false,${targetDelay});document.querySelector('#submit').addEventListener('click',async()=>{await fetch('/sandbox/approval-observed');document.querySelector('#result').textContent='Submitted';});`));
  app.get('/sandbox/approval-observed',async()=>{submissions++;return {ok:true};});
  const call=async(path,body,headers={})=>{
    const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  // This fixture owner explicitly reviews and authorizes configured publication changes.
  const ok=async(...args)=>{if(args[1]!==undefined&&/^\/studio\/workflows\/[^/]+\/publish$/.test(args[0])){const review=await ok(args[0].replace(/\/publish$/,'/permissions'));args[1]={expected_version:review.version,permission_fingerprint:review.fingerprint,...(review.changes?.breaking?{change_fingerprint:review.changes.fingerprint,accept_breaking:true}:{}),...args[1]};}const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const observe=async(id,predicate)=>{for(let n=0;n<500;n++){const run=await ok('/studio/runs/'+id);if(predicate(run))return run;await new Promise(done=>setTimeout(done,30));}throw Error('Fixture run did not reach expected state');};
  const waiting=id=>observe(id,run=>run.phase==='awaiting_approval');
  const terminal=id=>observe(id,run=>['succeeded','failed','cancelled'].includes(run.status));
  const ownerDecision=(run,decision='approve')=>ok(`/studio/runs/${run.id}/approval`,{approval_id:run.approval.id,decision});
  try{
    await app.listen({port,host:'127.0.0.1'});
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-workflow-safety-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Approval fixture',url:origin+'/sandbox/approval',access:'public',browser_mode:'isolated',authorized:true})).connection;
    await ok(`/studio/connections/${connection.id}/open`,{});await ok(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    function seed(slug,steps){
      const definition={contract_version:'2',effect:'retrieval',inputs:{},steps,outputs:[{name:'result',selector:'#result',type:'string'}],verifiers:[{kind:steps.some(step=>step.op==='click')?'changed':'nonempty',output:'result'}],timeout_ms:15000};
      definition.version=hash(JSON.stringify(definition));const id='wf_'+randomUUID();
      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(id,connection.id,slug,slug,'draft',definition.version,store.seal(definition),null,new Date().toISOString());
      return {id,definition};
    }
    const workflow=seed('safety.approval',[{op:'wait_text',selector:'#lookup',text:'Lookup ready'},{op:'click',selector:'#submit',locators:[{kind:'role',role:'button',name:'Submit record'}],approval_required:true}]);
    await t.test('owner sees exact scope and preview does not run the website',async()=>{
      const review=await ok(`/studio/workflows/${workflow.id}/permissions`);
      assert.deepEqual(review.allowed_origins,[origin]);assert.deepEqual(review.allowed_actions,['wait_text','click']);assert.deepEqual(review.approval_steps,[2]);
      assert.deepEqual(review.key_scope.operations,['run','read_own_runs','cancel_own_runs']);assert.equal(review.key_scope.can_approve,false);
      assert.equal(review.steps[1].selector,'#submit');assert.equal(submissions,0);
      assert.equal((await call(`/studio/workflows/${workflow.id}/permissions`,undefined,{cookie:''})).status,401);
      assert.equal((await call(`/studio/workflows/${workflow.id}/permissions?scope=other`)).status,400);
    });
    let receipt=await ok(`/studio/workflows/${workflow.id}/test`,{input:{}}),pending=await waiting(receipt.run_id);
    await t.test('earlier lookup runs but submission waits; approval is owner-only and one-shot',async()=>{
      assert.equal(pending.steps[0].status,'succeeded');assert.equal(pending.steps[1].status,'awaiting_approval');assert.equal(submissions,0);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},{cookie:''})).status,401);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},{'x-hermo-csrf':'bad'})).status,403);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:randomUUID(),decision:'approve'})).status,409);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve',steps:[]})).status,400);
      await ownerDecision(pending);assert.equal((await terminal(pending.id)).status,'succeeded');assert.equal(submissions,1);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'})).status,409);
    });
    const review=await ok(`/studio/workflows/${workflow.id}/permissions`);
    await t.test('publication rejects stale review and retains approval in its frozen revision',async()=>{
      assert.equal((await call(`/studio/workflows/${workflow.id}/publish`,{expected_version:'stale',permission_fingerprint:review.fingerprint})).value.error.code,'PERMISSION_REVIEW_CHANGED');
      assert.equal((await call(`/studio/workflows/${workflow.id}/publish`,{permission_fingerprint:'stale'})).status,409);
    });
    const key=await ok(`/studio/workflows/${workflow.id}/publish`,{expected_version:review.version,permission_fingerprint:review.fingerprint});
    const auth={authorization:'Bearer '+key.key,cookie:''},mcp={...auth,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'};
    const second=seed('safety.read',[]);receipt=await ok(`/studio/workflows/${second.id}/test`,{input:{}});assert.equal((await terminal(receipt.run_id)).status,'succeeded');
    const otherKey=await ok(`/studio/workflows/${second.id}/publish`,{}),otherAuth={authorization:'Bearer '+otherKey.key,cookie:''};
    const submit=(idempotency,headers=auth,slug='safety.approval')=>ok(`/v1/actions/${slug}/versions/1/runs`,{input:{}},{...headers,'idempotency-key':idempotency});
    await t.test('REST and MCP expose waiting but cannot approve or cross workflow boundaries',async()=>{
      assert.deepEqual((await ok('/v1/action-contract',undefined,auth)).approval_required_steps,[2]);
      const contract=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_contract',arguments:{}}},mcp);
      assert.deepEqual(contract.result.structuredContent.approval_required_steps,[2]);
      const tools=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},mcp);
      assert.equal(tools.result.tools.some(tool=>/approve/.test(tool.name)),false);
      const started=await ok('/mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'action_safety_approval',arguments:{input:{},request_id:'mcp-checkpoint'}}},mcp);
      pending=await waiting(started.result.structuredContent.run_id);
      const consumer=await ok('/v1/runs/'+pending.id,undefined,auth);assert.equal(consumer.phase,'awaiting_approval');assert.equal(consumer.input,undefined);assert.equal(JSON.stringify(consumer.approval).includes('#submit'),false);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},auth)).status,401);
      assert.equal((await call(`/v1/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},auth)).status,404);
      assert.equal((await call(`/v1/runs/${pending.id}`,undefined,otherAuth)).status,404);
      await ownerDecision(pending,'reject');const rejected=await terminal(pending.id);assert.equal(rejected.error.code,'APPROVAL_REJECTED');assert.equal(rejected.approval.status,'rejected');assert.equal(submissions,1);
      assert.equal((await call('/v1/actions/safety.read/versions/1/runs',{input:{}},{...auth,'idempotency-key':'wrong-workflow'})).status,403);
      assert.equal((await call('/v1/actions/safety.approval/versions/1/runs',{input:{},selector:'#danger'},{...auth,'idempotency-key':'injected-command'})).status,400);
    });
    await t.test('cancel and revocation block pending and queued runs without disabling other keys',async()=>{
      pending=await waiting((await submit('cancel-checkpoint')).run_id);await ok('/v1/runs/'+pending.id+'/cancel',{},auth);
      assert.equal((await terminal(pending.id)).status,'cancelled');assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'})).status,409);
      pending=await waiting((await submit('revoke-checkpoint')).run_id);const queued=await submit('revoke-queued');
      await ok('/studio/keys/'+key.id+'/revoke',{});
      assert.equal((await terminal(pending.id)).status,'cancelled');assert.equal((await terminal(queued.run_id)).status,'cancelled');
      assert.equal((await call('/v1/action-contract',undefined,auth)).status,401);assert.equal(submissions,1);
      const sibling=await submit('sibling-survives',otherAuth,'safety.read');assert.equal((await terminal(sibling.run_id)).status,'succeeded');
      assert.equal((await ok('/studio/overview')).connections.find(value=>value.id===connection.id).status,'connected');
    });
    await t.test('rotation replaces only the chosen key and retains scoped history',async()=>{
      const replacement=await ok('/studio/keys/'+otherKey.id+'/rotate',{});
      assert.equal((await call('/v1/action-contract',undefined,otherAuth)).status,401);
      assert.equal((await ok('/v1/action-contract',undefined,{authorization:'Bearer '+replacement.key,cookie:''})).action,'safety.read');
      const list=await ok('/studio/workflows/'+second.id+'/keys');assert.equal(list.keys.length,2);assert.equal(list.keys.find(item=>item.id===otherKey.id).revoked_at!==null,true);
      assert.equal(list.keys.every(item=>item.hash===undefined&&item.key===undefined),true);
    });
    await t.test('draft checkpoint edits invalidate verification without changing the live contract',async()=>{
      await ok(`/studio/workflows/${workflow.id}/draft`,{expected_version:workflow.definition.version});
      const editor=await ok(`/studio/workflows/${workflow.id}/editor`),body={expected_version:editor.version,steps:editor.definition.steps,inputs:editor.definition.inputs,outputs:editor.definition.outputs,verifiers:editor.definition.verifiers,timeout_seconds:15};
      body.steps[1].approval_required=false;
      const changed=await ok(`/studio/workflows/${workflow.id}/editor`,body);
      assert.equal(changed.workflow.tested,false);assert.deepEqual((await ok(`/studio/workflows/${workflow.id}/permissions`)).approval_steps,[]);
      assert.deepEqual((await ok(`/studio/workflows/${workflow.id}/permissions?scope=published`)).approval_steps,[2]);
      assert.equal((await call(`/studio/workflows/${workflow.id}/publish`,{})).value.error.code,'TEST_REQUIRED');
      body.expected_version=changed.version;body.steps[1].approval_required=true;await ok(`/studio/workflows/${workflow.id}/editor`,body);
    });
    await t.test('key expiry after approval still blocks a control that becomes ready later',async()=>{
      targetDelay=1800;
      try{
        const expiring=await ok('/studio/keys',{workflow_id:workflow.id,name:'Expiry after approval fixture'}),headers={authorization:'Bearer '+expiring.key,cookie:''};
        pending=await waiting((await submit('expire-after-approval',headers)).run_id);await ownerDecision(pending);
        store.db.prepare('UPDATE api_keys SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),expiring.id);
        const blocked=await terminal(pending.id);assert.equal(blocked.status,'failed');assert.equal(blocked.error.cause_code,'ACTION_PAUSED');assert.equal(submissions,1);
      }finally{targetDelay=0;}
    });
    await t.test('expired keys and total timeout cannot authorize a pending step',async()=>{
      const expiring=await ok('/studio/keys',{workflow_id:workflow.id,name:'Expiring fixture'}),headers={authorization:'Bearer '+expiring.key,cookie:''};
      pending=await waiting((await submit('expire-wait',headers)).run_id);store.db.prepare('UPDATE api_keys SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),expiring.id);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'})).status,409);
      await ok(`/studio/runs/${pending.id}/cancel`,{});await terminal(pending.id);
      receipt=await ok(`/studio/workflows/${workflow.id}/test`,{input:{}});pending=await waiting(receipt.run_id);
      const expired=await terminal(pending.id);assert.equal(expired.error.code,'WORKFLOW_TIMEOUT');assert.equal(expired.approval.status,'expired');assert.equal(submissions,1);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'})).status,409);
    });
  }finally{await app.close();}
});
