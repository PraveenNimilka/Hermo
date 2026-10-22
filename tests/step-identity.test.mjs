import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {assignStepIds,projectStepIds,validateWorkflowSteps} from '../server/workflow-steps.mjs';

const options={origins:['https://example.com'],inputs:{}};
const legacy=()=>[{op:'navigate',url:'https://example.com/'},{op:'click',selector:'#search',locators:[{kind:'role',role:'button',name:'Search'}]}];
const scope={workflowId:'wf_identity_fixture',version:'legacy-version'};

test('legacy step validation does not add identities or mutate recordings',()=>{
  const source=legacy(),before=structuredClone(source),validated=validateWorkflowSteps(source,options);
  assert.deepEqual(validated,before);assert.deepEqual(source,before);assert.notEqual(validated,source);
  assert.equal(validated.every(step=>!Object.hasOwn(step,'id')),true);
});

test('editor identity projection is deterministic, scoped and deeply nonmutating',()=>{
  const source=legacy(),before=structuredClone(source),first=projectStepIds(source,scope),second=projectStepIds(source,scope);
  assert.deepEqual(first,second);assert.deepEqual(source,before);assert.notEqual(first,source);
  assert.equal(new Set(first.map(step=>step.id)).size,2);
  for(const step of first)assert.match(step.id,/^step_[A-Za-z0-9_-]{8,80}$/);
  assert.notEqual(first[0].id,projectStepIds(source,{...scope,version:'new-version'})[0].id);
  assert.notEqual(first[0].id,projectStepIds(source,{...scope,workflowId:'wf_other_fixture'})[0].id);
  first[1].locators[0].name='Edited';assert.deepEqual(source,before);
  const reordered=[second[1],second[0]];
  assert.deepEqual(projectStepIds(reordered,{...scope,version:'next-version'}).map(step=>step.id),reordered.map(step=>step.id),'Existing IDs survive reordering and later draft versions');
});

test('new step assignment preserves supplied IDs, fills distinct identities and never repairs invalid IDs',()=>{
  const source=[{...legacy()[0],id:'step_existing_123'},legacy()[1],legacy()[1]],before=structuredClone(source),assigned=assignStepIds(source);
  assert.deepEqual(source,before);assert.equal(assigned[0].id,source[0].id);assert.equal(new Set(assigned.map(step=>step.id)).size,3);
  assert.deepEqual(assignStepIds(assigned),assigned);assert.notEqual(assignStepIds(source)[1].id,assigned[1].id);
  assigned[1].locators[0].name='Changed';assert.deepEqual(source,before);
  assert.deepEqual(assignStepIds([{op:'click',selector:'#search',id:'bad-id'}]),[{op:'click',selector:'#search',id:'bad-id'}]);
  assert.deepEqual(assignStepIds([]),[]);assert.deepEqual(projectStepIds([],scope),[]);
});

test('step validation rejects duplicate and malformed identities while accepting mixed legacy drafts',()=>{
  for(const id of ['step_short','step_'+'.'.repeat(8),'step_'+ 'a'.repeat(81),' step_existing_123',null,42])assert.throws(()=>validateWorkflowSteps([{op:'click',selector:'#search',id}],options),/INVALID_WORKFLOW_STEPS/);
  const duplicated=[{op:'click',selector:'#first',id:'step_same_identity'},{op:'click',selector:'#second',id:'step_same_identity'}];
  assert.throws(()=>validateWorkflowSteps(duplicated,options),/INVALID_WORKFLOW_STEPS/);
  const mixed=[{...legacy()[0],id:'step_existing_123'},legacy()[1]];assert.deepEqual(validateWorkflowSteps(mixed,options),mixed);
});

test('editor reads preserve legacy hashes and immutable revisions; saves persist identities and invalidate the draft',{timeout:20000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4598,engine={isOpen:()=>true,isPairing:()=>false,closeAll:async()=>{},closeStudios:async()=>{}};
  let state,cookie='',csrf='';
  try{
    state=await createApp({port,dataDir:resolve('work/step-identity',randomUUID()),browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];return {status:response.statusCode,value:response.json()};};
    const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-step-identity-fixture-owner'})).csrf;
    const at=new Date().toISOString(),cid='conn_step_identity',wid='wf_step_identity',base='/studio/workflows/'+wid,url=origin+'/sandbox/step-identity';
    const definition={contract_version:'2',inputs:{},steps:[{op:'click',selector:'#first'},{op:'click',selector:'#second'}],outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Step identity browser',url,'connected',store.seal({url,origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Step identity fixture','step.identity.fixture','published',definition.version,store.seal(definition),definition.version,at);
    await ok('/studio/overview');await ok(base+'/draft',{expected_version:definition.version});
    const original=store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid),revision=store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid);
    const first=await ok(base+'/editor'),again=await ok(base+'/editor');assert.deepEqual(first.definition,again.definition);assert.equal(first.version,definition.version);assert.equal(first.definition.version,definition.version);
    assert.deepEqual(store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid),original,'GET projection never rewrites encrypted bytes or hash');
    assert.equal(store.unseal(original.payload).steps.every(step=>step.id===undefined),true);
    const submitted=[first.definition.steps[1],first.definition.steps[0],{op:'click',selector:'#new'}],body={expected_version:first.version,steps:submitted,inputs:{},outputs:first.definition.outputs,verifiers:first.definition.verifiers,timeout_seconds:45};
    const saved=await ok(base+'/editor',body);assert.notEqual(saved.version,definition.version);assert.deepEqual(saved.definition.steps.slice(0,2).map(step=>step.id),submitted.slice(0,2).map(step=>step.id));assert.match(saved.definition.steps[2].id,/^step_[A-Za-z0-9_-]{8,80}$/);
    const stored=store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid);assert.equal(stored.test_version,null);assert.deepEqual(store.unseal(stored.payload),saved.definition);assert.deepEqual((await ok(base+'/editor')).definition,saved.definition);
    assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid),revision);
    const duplicate=await call(base+'/editor',{...body,expected_version:saved.version,steps:[saved.definition.steps[0],saved.definition.steps[0]]});assert.equal(duplicate.status,400);assert.deepEqual(store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid),stored,'Invalid duplicate identities leave the stored draft untouched');
    const roundtrip=await ok(base+'/editor',{...body,expected_version:saved.version,steps:saved.definition.steps});assert.equal(roundtrip.version,saved.version);assert.deepEqual(roundtrip.definition.steps,saved.definition.steps);
  }finally{await state?.app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
