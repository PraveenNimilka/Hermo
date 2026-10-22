import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {verifyResult} from '../server/verification.mjs';
import {workflowTemplateCatalog,validateWorkflowTemplate,templateSlots,configureWorkflowTemplate,exportWorkflowTemplate} from '../server/workflow-templates.mjs';

const c={id:'conn_template',url:'https://example.com/',origins:['https://example.com'],browser_mode:'isolated',access:'public'};
const configurationFor=(template,origin='https://example.com')=>Object.fromEntries(Object.entries(templateSlots(template)).map(([kind,slots])=>[kind,Object.fromEntries(slots.map(slot=>[slot,kind==='urls'?origin+'/sandbox/template':kind==='targets'?'#'+slot:'synthetic-value']))]));

test('all eight templates configure bounded, typed drafts and retain explicit approvals',()=>{
  assert.equal(workflowTemplateCatalog.length,8);
  for(const entry of workflowTemplateCatalog){
    const template=validateWorkflowTemplate(entry.template),definition=configureWorkflowTemplate(template,configurationFor(template),c);
    assert.ok(definition.version);assert.equal(definition.timeout_ms,45000);assert.ok(definition.steps.every(step=>step.id));
    assert.ok(definition.outputs.length);assert.equal(definition.effect,'retrieval');
    assert.ok(definition.steps.length<=32);
  }
  const form=workflowTemplateCatalog.find(item=>item.id==='approved-form');
  assert.equal(configureWorkflowTemplate(form.template,configurationFor(form.template),c).steps[1].approval_required,true);
  const managed=workflowTemplateCatalog.find(item=>item.id==='authenticated-managed');
  assert.throws(()=>configureWorkflowTemplate(managed.template,configurationFor(managed.template),{...c,browser_mode:'connected'}),/EXECUTION_INCOMPATIBLE/);
});

test('neutral import format rejects captured website data, executable targets, overbounds and unknown metadata',()=>{
  const original=workflowTemplateCatalog[0].template;
  for(const mutate of [
    value=>{value.name='secret name';},value=>{value.structure.connection_id='conn_private';},
    value=>{value.structure.steps[0].selector='#private';},value=>{value.structure.steps[0].target='https://private.example/';},
    value=>{value.structure.inputs[0].default='secret';},value=>{value.structure.inputs[0].example='secret';},
    value=>{value.structure.inputs[0].enum=['secret'];},value=>{value.structure.outputs[0].name='private';},
    value=>{value.structure.outputs[0].label='private';},value=>{value.structure.outputs[0].selector='javascript:doBad()';},
    value=>{value.structure.steps.push({op:'evaluate',code:'document.cookie'});},value=>{value.structure.steps[0].input='input_99';},
    value=>{value.structure.timeout_seconds=301;},value=>{value.structure.steps=Array(33).fill(value.structure.steps[0]);}
  ]){const value=structuredClone(original);mutate(value);assert.throws(()=>validateWorkflowTemplate(value),/INVALID_TEMPLATE/);}
  const template=workflowTemplateCatalog.find(item=>item.id==='detail-page').template,config=configurationFor(template);
  assert.throws(()=>configureWorkflowTemplate(template,{...config,targets:{...config.targets,extra:'#private'}},c));
  assert.throws(()=>configureWorkflowTemplate(template,{...config,urls:{url_1:'https://outside.example/'}},c));
  assert.throws(()=>configureWorkflowTemplate(template,{...config,targets:{target_1:'xpath=//secret'}},c));
});

test('owner export is an allowlist and contains no names, URLs, selectors, examples or private values',()=>{
  const definition={inputs:{private_reference:{type:'string',required:true,default:'secret-default',example:'secret-example'}},outputs:[{name:'private_answer',selector:'#secret-output',type:'string'}],steps:[{id:'step_private123',op:'fill',selector:'#secret-input',parameter:'private_reference',risk:'high',label:'secret-label'},{op:'click',selector:'#secret-submit',approval_required:true}],verifiers:[{output:'private_answer',input:'private_reference'}],timeout_ms:45000};
  const result=exportWorkflowTemplate({...definition,url:'https://secret.example',storageState:'secret-storage',name:'secret-name'});
  const text=JSON.stringify(result);assert.doesNotMatch(text,/secret|private|https:|step_private|selector|default|example|label|storageState/);
  assert.deepEqual(result.structure.inputs,[{type:'string',required:true}]);assert.equal(result.structure.steps[1].approval_required,true);
  assert.equal(result.structure.verifiers[0].input,'input_1');assert.equal(result.structure.verifiers[0].output,'output_1');
  const unsupported=structuredClone(definition);unsupported.steps[0].value_path=['secret'];assert.throws(()=>exportWorkflowTemplate(unsupported),/INVALID_TEMPLATE/);
  const protectedWait={...definition,steps:[{op:'click',selector:'#submit'},{op:'wait_element',selector:'#result',state:'visible'}],approval_policy:{mode:'selected_steps',steps:[2]}};
  assert.throws(()=>exportWorkflowTemplate(protectedWait),/INVALID_TEMPLATE/,'A protected wait after a website action must never become an earlier invocation gate');
});

test('real owner routes import inert structures, create drafts only and require normal verification and permission review',{timeout:20000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');let executions=0;
  // Controlled browser adapter: route, state and publication authority tests,
  // not evidence that an external website supports a selected CSS target.
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_c,definition,input,progress)=>{
    executions++;for(let i=0;i<definition.steps.length;i++){progress(i,definition.steps.length);progress(i,definition.steps.length,{phase:'completed'});}progress(definition.steps.length,definition.steps.length,{phase:'verifying'});
    const result={output_1:'Fixture result'};return {result,verification:verifyResult(definition,result,input,'controlled_adapter')};
  }};
  const port=4679,{app,store,origin}=await createApp({port,dataDir:resolve('work/template-tests',randomUUID()),browserEngineFactory:async()=>engine});
  let cookie='',csrf='';
  const call=async(path,body,headers={})=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,'x-hermo-csrf':csrf,...headers},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];return {status:response.statusCode,data:response.json()};};
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.data;};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-template-fixture-password'})).csrf;
    const at=new Date().toISOString();store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_template','Synthetic template website',origin+'/sandbox/template','connected',store.seal({url:origin+'/sandbox/template',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    const catalog=await ok('/studio/templates');assert.equal(catalog.templates.length,8);
    const template=catalog.templates.find(item=>item.id==='detail-page').template;
    const before=store.db.prepare('SELECT count(*) n FROM workflows').get().n;
    const imported=await ok('/studio/templates/import',{template});assert.deepEqual(imported.template,template);
    assert.equal(store.db.prepare('SELECT count(*) n FROM workflows').get().n,before);assert.equal(executions,0);
    const body={template,connection_id:'conn_template',name:'Template fixture',slug:'template.fixture',authorized:true,configuration:configurationFor(template,origin)};
    assert.equal((await call('/studio/templates/instantiate',body,{cookie:''})).status,401);
    assert.equal((await call('/studio/templates/instantiate',body,{'x-hermo-csrf':'bad'})).status,403);
    assert.equal((await call('/studio/templates/instantiate',{...body,authorized:false})).status,400);
    assert.equal((await call('/studio/templates/instantiate',{...body,configuration:{...body.configuration,urls:{url_1:'https://outside.example/private'}}})).status,400);
    const created=await ok('/studio/templates/instantiate',body),w=created.workflow;
    assert.equal(created.requires_test,true);assert.equal(w.status,'draft');assert.equal(w.tested,false);assert.equal(w.published_revision,null);assert.equal(executions,0);
    const base='/studio/workflows/'+w.id;
    assert.equal((await call(base+'/publish',{})).data.error.code,'TEST_REQUIRED');
    const exported=await ok(base+'/template');assert.doesNotMatch(JSON.stringify(exported),/conn_template|template\.fixture|Fixture|#target|127\.0\.0\.1/);
    const runId=(await ok(base+'/test',{input:{}})).run_id;let run;
    for(let i=0;i<100;i++){run=await ok('/studio/runs/'+runId);if(['succeeded','failed','cancelled'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(executions,1);
    assert.equal((await call(base+'/publish',{})).data.error.code,'PERMISSION_REVIEW_REQUIRED');
    const permission=await ok(base+'/permissions'),published=await ok(base+'/publish',{expected_version:permission.version,permission_fingerprint:permission.fingerprint});assert.equal(published.workflow.published_revision,1);
    const invoked=await ok('/v1/actions/'+w.slug+'/versions/1/runs',{input:{}},{cookie:'',authorization:'Bearer '+published.key,'idempotency-key':randomUUID()});
    for(let i=0;i<100;i++){run=await ok('/v1/runs/'+invoked.run_id,undefined,{cookie:'',authorization:'Bearer '+published.key});if(['succeeded','failed','cancelled'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(executions,2);
    const anonymous=await call('/studio/templates',undefined,{cookie:'',authorization:'Bearer '+published.key});assert.equal(anonymous.status,401);
    const denied=await call('/studio/templates/instantiate',{...body,slug:'template.denied'},{cookie:'',authorization:'Bearer '+published.key});assert.equal(denied.status,401);
    const row=store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(w.id),stored=store.unseal(row.payload);assert.equal(hash(JSON.stringify(Object.fromEntries(Object.entries(stored).filter(([key])=>key!=='version')))),stored.version);
  }finally{await app.close();}
});
