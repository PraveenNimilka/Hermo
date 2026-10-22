import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('configured approval policies protect real managed execution, immutable publication and REST/MCP metadata',{timeout:150000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));
  const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const {app,origin,store}=await createApp({port,dataDir:resolve('work/approval-policy-runtime',randomUUID())});
  let submissions=0,cookie='',csrf='';
  app.get('/sandbox/policy',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Controlled approval policy fixture</title><p id="ready">Ready for policy test</p><button id="submit" aria-label="Submit controlled record">Submit controlled record</button><p id="result">Waiting for this invocation</p><script src="/sandbox/policy-fixture.js"></script>'));
  app.get('/sandbox/policy-fixture.js',async(_,reply)=>reply.type('text/javascript').send("document.querySelector('#submit').addEventListener('click',async()=>{const value=await fetch('/sandbox/policy-counter').then(response=>response.json());document.querySelector('#result').textContent='Submitted '+value.count;});"));
  // Deliberately controlled GET side effect, matching the retrieval-only adapter
  // boundary. This test does not broaden browser network or mutation permissions.
  app.get('/sandbox/policy-counter',async()=>({count:++submissions}));
  const call=async(path,body,headers={})=>{
    const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const result=await call(...args);assert.ok(result.status<300,JSON.stringify(result));return result.value;};
  const observe=async(runId,predicate)=>{
    const deadline=Date.now()+22000;
    while(Date.now()<deadline){const run=await ok('/studio/runs/'+runId);if(predicate(run))return run;if(['succeeded','failed','cancelled'].includes(run.status))assert.fail('Unexpected terminal run: '+JSON.stringify(run));await new Promise(done=>setTimeout(done,35));}
    assert.fail('Controlled run did not reach its expected state');
  };
  const waiting=id=>observe(id,run=>run.phase==='awaiting_approval');
  const terminal=id=>observe(id,run=>['succeeded','failed','cancelled'].includes(run.status));
  const decide=(run,decision)=>ok(`/studio/runs/${run.id}/approval`,{approval_id:run.approval.id,decision});
  try{
    await app.listen({port,host:'127.0.0.1'});
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-approval-policy-runtime-owner'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Controlled policy website',url:origin+'/sandbox/policy',access:'public',browser_mode:'isolated',authorized:true})).connection;
    await ok(`/studio/connections/${connection.id}/open`,{});await ok(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    const workflowId='wf_'+randomUUID(),base='/studio/workflows/'+workflowId;
    const definition={contract_version:'2',effect:'retrieval',inputs:{},steps:[],outputs:[{name:'result',selector:'#result',type:'string'}],verifiers:[{kind:'changed',output:'result'}],timeout_ms:15000};
    definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(workflowId,connection.id,'Controlled approval policy','policy.controlled','draft',definition.version,store.seal(definition),null,new Date().toISOString());
    const riskPolicy={mode:'risk_rules',rules:[{operations:['click'],risks:['high']}]};
    const steps=[{op:'wait_text',selector:'#ready',text:'Ready for policy test',risk:'low'},{op:'click',selector:'#submit',locators:[{kind:'role',role:'button',name:'Submit controlled record'}],risk:'high'},{op:'click',selector:'#disabled-missing',risk:'high',enabled:false}];
    const load=()=>ok(base+'/editor');
    const save=(editor,policy=editor.definition.approval_policy,selectedSteps=editor.definition.steps)=>call(base+'/editor',{expected_version:editor.version,steps:selectedSteps,approval_policy:policy,inputs:editor.definition.inputs,outputs:editor.definition.outputs,verifiers:editor.definition.verifiers,timeout_seconds:15});
    let editor=await load();const saved=await save(editor,riskPolicy,steps);assert.equal(saved.status,200,JSON.stringify(saved));editor=saved.value;
    const authorBefore=store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(workflowId);
    const author=store.unseal(authorBefore.payload),{version:authorVersion,...authorContent}=author;
    assert.equal(authorVersion,hash(JSON.stringify(authorContent)));
    assert.deepEqual(author.approval_policy,riskPolicy);assert.notEqual(author.steps[1].approval_required,true,'Risk gating is compiled on a private copy rather than rewriting the authoring steps');
    await t.test('risk metadata produces a real click checkpoint while earlier wait and disabled exclusion remain correct',async()=>{
      const review=await ok(base+'/permissions');assert.deepEqual(review.approval_steps,[2]);assert.equal(submissions,0);
      const started=await ok(base+'/test',{input:{}}),pending=await waiting(started.run_id);
      assert.equal(pending.steps[0].status,'succeeded');assert.equal(pending.steps[1].status,'awaiting_approval');assert.equal(submissions,0);
      const inbox=await ok('/studio/approvals?view=pending&limit=25'),item=inbox.items.find(value=>value.run_id===pending.id);
      assert.equal(item.actionable,true);assert.equal(item.approval.step,2);assert.equal(item.approval.operation,'click');assert.equal(item.approval.context.risk,'high');
      assert.equal(item.approval.context.website_origin,origin);
      assert.equal((await call('/studio/approvals',undefined,{cookie:''})).status,401);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},{cookie:''})).status,401);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},{'x-hermo-csrf':'invalid'})).status,403);
      await decide(pending,'reject');const rejected=await terminal(pending.id);
      assert.equal(rejected.approval.status,'rejected');assert.equal(rejected.error.cause_code,'APPROVAL_REJECTED');assert.equal(submissions,0);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'})).status,409);
      const history=await ok('/studio/approvals?view=history&limit=25');assert.equal(history.items.find(value=>value.run_id===pending.id).approval.status,'rejected');
      const next=await waiting((await ok(base+'/test',{input:{}})).run_id);assert.equal(submissions,0);await decide(next,'approve');
      const verified=await terminal(next.id);assert.equal(verified.status,'succeeded',JSON.stringify(verified));assert.equal(submissions,1);assert.equal(verified.steps[2].status,'skipped');
      assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(workflowId),authorBefore,'Compilation and verification leave authoring hash/content unchanged');
    });
    const review=await ok(base+'/permissions'),publication=await ok(base+'/publish',{expected_version:review.version,permission_fingerprint:review.fingerprint});
    const auth={authorization:'Bearer '+publication.key,cookie:''},mcp={...auth,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'};
    const snapshot=store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(workflowId);
    assert.deepEqual(store.unseal(snapshot.payload).definition.approval_policy,riskPolicy);
    await t.test('REST and MCP share policy metadata and consumer keys cannot decide or read owner inbox',async()=>{
      assert.deepEqual((await ok('/v1/action-contract',undefined,auth)).approval_required_steps,[2]);
      const contract=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_contract',arguments:{}}},mcp);
      assert.deepEqual(contract.result.structuredContent.approval_required_steps,[2]);
      assert.equal((await call('/studio/approvals',undefined,auth)).status,401);
      const submitted=await ok('/v1/actions/policy.controlled/versions/1/runs',{input:{}},{...auth,'idempotency-key':'controlled-approved-once'}),pending=await waiting(submitted.run_id);
      assert.equal(submissions,1);
      assert.equal((await call(`/studio/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},auth)).status,401);
      assert.equal((await call(`/v1/runs/${pending.id}/approval`,{approval_id:pending.approval.id,decision:'approve'},auth)).status,404);
      await decide(pending,'approve');const done=await terminal(pending.id);assert.equal(done.status,'succeeded',JSON.stringify(done));assert.equal(submissions,2);
      const replay=await ok('/v1/actions/policy.controlled/versions/1/runs',{input:{}},{...auth,'idempotency-key':'controlled-approved-once'});assert.equal(replay.run_id,submitted.run_id);assert.equal(replay.reused,true);assert.equal(submissions,2);
      const started=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'action_policy_controlled',arguments:{input:{},request_id:'controlled-mcp-reject'}}},mcp);
      const mcpPending=await waiting(started.result.structuredContent.run_id);assert.equal(submissions,2);await decide(mcpPending,'reject');await terminal(mcpPending.id);assert.equal(submissions,2);
      const history=await ok('/studio/approvals?view=history&limit=25');assert.ok(history.items.some(value=>value.run_id===submitted.run_id&&value.approval.status==='approved'));
      assert.equal(JSON.stringify(history).includes('#submit'),false);assert.equal(JSON.stringify(history).includes(publication.key),false);
    });
    await t.test('policy draft changes do not rewrite a live revision and each invocation gates its first enabled step',async()=>{
      await ok(base+'/draft',{expected_version:editor.version});editor=await load();
      let changed=await save(editor,{mode:'none'});assert.equal(changed.status,200,JSON.stringify(changed));editor=changed.value;
      assert.equal(editor.workflow.tested,false);assert.deepEqual((await ok(base+'/permissions')).approval_steps,[]);
      assert.deepEqual((await ok(base+'/permissions?scope=published')).approval_steps,[2]);assert.deepEqual((await ok('/v1/action-contract',undefined,auth)).approval_required_steps,[2]);
      assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(workflowId),snapshot);
      const firstEnabled=[steps[2],steps[0],steps[1]];
      changed=await save(editor,{mode:'every_invocation'},firstEnabled);assert.equal(changed.status,200,JSON.stringify(changed));editor=changed.value;
      assert.deepEqual((await ok(base+'/permissions')).approval_steps,[2]);
      const pending=await waiting((await ok(base+'/test',{input:{}})).run_id);
      assert.equal(pending.steps[0].status,'skipped');assert.equal(pending.steps[1].status,'awaiting_approval');assert.equal(pending.approval.operation,'wait_text');assert.equal(submissions,2);
      await decide(pending,'approve');const finished=await terminal(pending.id);assert.equal(finished.status,'succeeded',JSON.stringify(finished));assert.equal(submissions,3);
      const repeated=await waiting((await ok(base+'/test',{input:{}})).run_id);assert.equal(repeated.approval.step,2);assert.equal(submissions,3);await decide(repeated,'reject');await terminal(repeated.id);assert.equal(submissions,3);
      assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(workflowId),snapshot);
    });
    await t.test('invalid policies fail before executing anything and preserve the saved draft',async()=>{
      editor=await load();const before=store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(workflowId),count=submissions;
      for(const policy of [{mode:'unknown'},{mode:'selected_steps',steps:[32]},{mode:'risk_rules',rules:[{}]},{mode:'risk_rules',rules:[{operations:['click'],risks:['guessed']}]},{mode:'none',bypass:true}]){
        const invalid=await save(editor,policy);assert.equal(invalid.status,400,JSON.stringify(invalid));assert.equal(submissions,count);
        assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(workflowId),before);
      }
      // Output-only and disabled-only invocation gates are covered by the
      // invocation approval suite; malformed policy metadata still fails closed.
      const malformedInvocation=await save(editor,{mode:'every_invocation',unexpected:true},steps.map(step=>({...step,enabled:false})));assert.equal(malformedInvocation.status,400,JSON.stringify(malformedInvocation));assert.equal(submissions,count);
      assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(workflowId),before);
    });
  }finally{await app.close();}
});
