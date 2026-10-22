import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowSpec} from '../server/api-spec.mjs';

const workflow={id:'wf_spec',name:'Published revision fixture',slug:'catalog.read',version:'immutable-fixture-version',revision:2,definition:{inputs:{query:{type:'string',required:true}},outputs:[{name:'answer',type:'string',selector:'#private-output-locator'}],steps:[],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval'}};
const spec=workflowSpec(workflow,'http://127.0.0.1:4317');
const jsonSchema=response=>response.content['application/json'].schema;

test('OpenAPI preserves active admission and documents immutable revision invocation separately',()=>{
  const active=spec.paths['/v1/actions/catalog.read/versions/1/runs'].post;
  assert.equal(active.operationId,'catalog_read');assert.equal(jsonSchema(active.requestBody).properties.input.properties.query.type,'string');
  assert.equal(jsonSchema(active.requestBody).properties.expected_revision.type,'integer');assert.ok(active.responses['202']);
  const historical=spec.paths['/v1/actions/catalog.read/revisions/{revision}/runs'].post;
  assert.notEqual(historical.operationId,active.operationId);
  assert.deepEqual(historical.parameters.find(item=>item.name==='revision'),{name:'revision',in:'path',required:true,schema:{type:'integer',minimum:1,maximum:1000000}});
  assert.equal(historical.parameters.find(item=>item.name==='Idempotency-Key').required,true);
  const body=jsonSchema(historical.requestBody);assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['input']);assert.deepEqual(Object.keys(body.properties),['input']);
  assert.deepEqual(body.properties.input.additionalProperties,{},'Historical admission accepts bounded JSON and validates against the selected revision contract');
  assert.match(body.properties.input.description,/Bounded JSON values/);
  assert.match(body.properties.input.description,/action-contract\?revision=N/);
  assert.match(historical.responses['409'].description,/IDEMPOTENCY_REVISION_CONFLICT/);assert.ok(historical.responses['404']);
  assert.equal(spec['x-hermo-revision'],2);assert.equal(spec['x-hermo-workflow-version'],workflow.version);
});

test('OpenAPI exposes scoped revision discovery and contract selection without private configuration',()=>{
  const list=spec.paths['/v1/action-revisions'].get,contract=spec.paths['/v1/action-contract'].get;
  const revisions=jsonSchema(list.responses['200']);assert.deepEqual(revisions.required,['active_revision','revisions']);
  assert.deepEqual(Object.keys(revisions.properties.revisions.items.properties).sort(),['active','created_at','execution_mode','revision','version']);
  const revision=contract.parameters.find(item=>item.name==='revision');assert.equal(revision.in,'query');assert.equal(revision.required,false);assert.equal(revision.schema.maximum,1000000);
  const selected=jsonSchema(contract.responses['200']);assert.equal(selected.properties.input_schema.type,'object');assert.equal(selected.properties.output_schema.type,'object');assert.equal(selected.properties.approval_invocation_required.type,'boolean');
  assert.ok(contract.responses['404']);assert.ok(contract.responses['409']);
  assert.deepEqual(spec.security,[{HermoKey:[]}]);assert.equal(spec.components.securitySchemes.HermoKey.scheme,'bearer');
  assert.equal(JSON.stringify(spec).includes('#private-output-locator'),false);
  assert.equal(Object.keys(spec.paths).some(path=>path.startsWith('/studio/')),false,'Consumer OpenAPI does not imply owner approval or publication authority');
  assert.ok(spec.paths['/v1/runs/{run_id}']);assert.ok(spec.paths['/v1/runs/{run_id}/receipt']);
});
