import test from 'node:test';
import assert from 'node:assert/strict';
import {compareWorkflowChanges,compareJsonSchemas} from '../server/workflow-changes.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const base=()=>({inputs:{query:{type:'string',required:true,maxLength:200}},outputs:[{name:'answer',type:'string',selector:'#result'}],steps:[{id:'submit',op:'click',selector:'#submit',approval_required:true}],verifiers:[],effect:'recorded_browser_actions'});
const connection=()=>({id:'conn_example',url:'https://example.com/app',origins:['https://example.com'],browser_mode:'connected',access:'account'});
function review(change,connectionChange=()=>{}){
  const before=base(),after=clone(before),beforeConnection=connection(),afterConnection=clone(beforeConnection);
  change(after);connectionChange(afterConnection);
  return compareWorkflowChanges({before,after,beforeConnection,afterConnection});
}
const schema=(type,extra={})=>({type,...extra});
const breaking=(before,after,direction)=>compareJsonSchemas(before,after,{direction}).some(change=>change.breaking);

test('identical configurations produce no changes and a bound deterministic fingerprint',()=>{
  const value=review(()=>{});
  assert.equal(value.breaking,false);assert.deepEqual(value.input_changes,[]);assert.deepEqual(value.output_changes,[]);assert.deepEqual(value.permission_changes,[]);
  assert.equal(value.permission_review_required,false);assert.match(value.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(value.fingerprint,review(()=>{}).fingerprint);
  assert.notEqual(value.fingerprint,review(after=>{after.steps[0].value='different';}).fingerprint);
});

test('optional output additions preserve the contract but expand declared exposure',()=>{
  const value=review(after=>after.outputs.push({name:'caption',type:'string',selector:'#caption',required:false}));
  assert.equal(value.breaking,false);assert.equal(value.permissions_expanded,true);assert.equal(value.permission_review_required,true);
  assert.deepEqual(value.output_changes,[{path:['outputs','caption'],reason:'field_added',breaking:false}]);
  assert.ok(value.permission_changes.some(change=>change.reason==='returned_field_added'));
});

test('removed output, optional guaranteed output, changed type and nullable widening are breaking',()=>{
  for(const change of [after=>{after.outputs=[];},after=>{after.outputs[0].required=false;},after=>{after.outputs[0].type='number';},after=>{after.outputs[0].nullable=true;}])assert.equal(review(change).breaking,true);
  const old=schema('string'),nullable={anyOf:[old,{type:'null'}]};
  assert.equal(breaking(nullable,old,'output'),false);
  assert.equal(breaking(old,nullable,'output'),true);
  assert.equal(breaking(nullable,old,'input'),true);
  assert.equal(breaking(old,nullable,'input'),false);
});

test('input additions, optionality, defaults, enums and bounds follow accepted-request direction',()=>{
  assert.equal(review(after=>{after.inputs.limit={type:'number',required:true};}).breaking,true);
  assert.equal(review(after=>{after.inputs.limit={type:'number',required:false};}).breaking,false);
  assert.equal(review(after=>{after.inputs.query.maxLength=100;}).breaking,true);
  assert.equal(review(after=>{after.inputs.query.maxLength=300;}).breaking,false);
  assert.equal(review(after=>{after.inputs.query.enum=['allowed'];}).breaking,true);
  assert.equal(review(after=>{after.inputs.query.required=false;}).breaking,false);
  const before=base();before.inputs.query.required=false;
  const after=clone(before);after.inputs.query.required=true;
  assert.equal(compareWorkflowChanges({before,after,beforeConnection:connection(),afterConnection:connection()}).breaking,true);
  before.inputs.query={type:'string',required:true,default:'private-default'};
  after.inputs.query={type:'string',required:true};
  const removedDefault=compareWorkflowChanges({before,after,beforeConnection:connection(),afterConnection:connection()});
  assert.equal(removedDefault.breaking,true);assert.equal(JSON.stringify(removedDefault).includes('private-default'),false);
});

test('returned enum/bounds widening is breaking and narrowing is compatible',()=>{
  for(const [before,after]of [[schema('number',{minimum:0}),schema('number',{minimum:-1})],[schema('string',{enum:['a']}),schema('string',{enum:['a','b']})],[schema('array',{items:schema('string'),maxItems:10}),schema('array',{items:schema('string'),maxItems:20})],[schema('string',{pattern:'^a$'}),schema('string')],[schema('array',{items:schema('string'),uniqueItems:true}),schema('array',{items:schema('string')})]]){
    assert.equal(breaking(before,after,'output'),true);assert.equal(breaking(after,before,'output'),false);
    assert.equal(breaking(before,after,'input'),false);assert.equal(breaking(after,before,'input'),true);
  }
  assert.equal(breaking(schema('integer'),schema('number'),'output'),true);
  assert.equal(breaking(schema('number'),schema('integer'),'output'),false);
});

test('nested objects and array item constraints report exact bounded paths',()=>{
  const before=base();before.outputs=[{name:'products',type:'array',selector:'.product',minItems:0,maxItems:10,items:{type:'object',fields:[{name:'price',type:'object',fields:[{name:'amount',type:'number',selector:'.amount',minimum:0}]}]}}];
  const after=clone(before);after.outputs[0].items.fields[0].fields[0].minimum=-1;
  const value=compareWorkflowChanges({before,after,beforeConnection:connection(),afterConnection:connection()});
  assert.deepEqual(value.output_changes,[{path:['outputs','products','items','price','amount'],reason:'minimum_changed',breaking:true}]);
  after.outputs[0].items.fields.push({name:'optional',type:'string',selector:'.optional',required:false});
  assert.ok(compareWorkflowChanges({before,after,beforeConnection:connection(),afterConnection:connection()}).permission_changes.some(change=>change.reason==='returned_field_added'&&change.path.join('.')==='permissions.outputs.products.items.optional'));
});

test('permission changes distinguish origins, modes, enabled operations and gates without values',()=>{
  const value=review(after=>{after.steps[0].approval_required=false;after.steps.push({op:'fill',selector:'#private-selector',value:'secret-field-value'});},after=>{after.origins.push('https://private-host.example');after.browser_mode='isolated';after.browser_workspace_id='private-browser-id';});
  assert.equal(value.breaking,false);assert.equal(value.permissions_expanded,true);
  for(const reason of ['origin_added','execution_mode_changed','browser_binding_changed','action_added','approval_removed'])assert.ok(value.permission_changes.some(change=>change.reason===reason),reason);
  const text=JSON.stringify(value);
  for(const secret of ['private-host','private-selector','secret-field-value','private-browser-id','#submit'])assert.equal(text.includes(secret),false,secret);
  const reduced=review(after=>{after.steps[0].enabled=false;},after=>{after.origins=[];});
  assert.ok(reduced.permission_changes.some(change=>change.reason==='origin_removed'&&change.direction==='reduced'));
  assert.ok(reduced.permission_changes.some(change=>change.reason==='action_removed'&&change.direction==='reduced'));
});

test('stable gates survive reordering while changed protected payload still requires review',()=>{
  const before=base();before.steps.push({id:'navigate',op:'navigate',url:'https://example.com/app'});
  const after=clone(before);after.steps.reverse();
  let value=compareWorkflowChanges({before,after,beforeConnection:connection(),afterConnection:connection()});
  assert.equal(value.permission_changes.some(change=>change.reason==='approval_removed'),false);
  after.steps[1].selector='#different-target';
  value=compareWorkflowChanges({before,after,beforeConnection:connection(),afterConnection:connection()});
  assert.ok(value.permission_changes.some(change=>change.reason==='protected_action_changed'));
  assert.equal(JSON.stringify(value).includes('different-target'),false);
});

test('extraction and unknown schema changes are conservatively reviewed without disclosing predicates',()=>{
  const value=review(after=>{after.outputs[0].selector='[data-private="customer"]';});
  assert.equal(value.breaking,false);assert.equal(value.permission_review_required,true);
  assert.ok(value.permission_changes.some(change=>change.reason==='extraction_scope_changed'));
  assert.equal(JSON.stringify(value).includes('customer'),false);
  const unknown=compareJsonSchemas(schema('string',{'custom-private-key':'old-secret'}),schema('string',{'custom-private-key':'new-secret'}),{direction:'output'});
  assert.deepEqual(unknown,[{path:[],reason:'schema_change_unclassified',breaking:true}]);
  assert.equal(breaking(schema('string',{'x-hermo-future-policy':true}),schema('string',{'x-hermo-future-policy':false}),'output'),true);
  assert.equal(breaking(schema('string',{pattern:'^a$'}),schema('string',{pattern:'^b$'}),'output'),true);
  assert.equal(breaking(schema('string',{pattern:'^a$'}),schema('string',{pattern:'^b$'}),'input'),true);
  assert.deepEqual(compareJsonSchemas(schema('string',{description:'secret'}),schema('string',{description:'other'})),[]);
});

test('canonical object key order does not affect report or fingerprint and inputs are never mutated',()=>{
  const before=base(),after=clone(before),beforeConnection=connection(),afterConnection=connection(),snapshot=JSON.stringify({before,after,beforeConnection,afterConnection});
  const first=compareWorkflowChanges({before,after,beforeConnection,afterConnection});
  const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverse(value[key])])):value;
  const second=compareWorkflowChanges(reverse({before,after,beforeConnection,afterConnection}));
  assert.deepEqual(first,second);assert.equal(JSON.stringify({before,after,beforeConnection,afterConnection}),snapshot);
  afterConnection.identity={selector:'#private-account',text:'secret-identity'};
  const third=compareWorkflowChanges({before,after,beforeConnection,afterConnection});
  assert.notEqual(first.fingerprint,third.fingerprint);assert.equal(JSON.stringify(third).includes('secret-identity'),false);
});

test('unknown unions and property policies are conservative, and diagnostic path segments cannot carry values',()=>{
  assert.equal(breaking({anyOf:[{type:'string'},{type:'number'}]},{anyOf:[{type:'string'},{type:'boolean'}]},'output'),true);
  assert.equal(breaking(schema('object',{additionalProperties:true}),schema('object',{additionalProperties:false}),'input'),true);
  assert.equal(breaking(schema('object',{additionalProperties:false}),schema('object',{additionalProperties:true}),'output'),true);
  const value=compareJsonSchemas(schema('object',{properties:{}}),schema('object',{properties:{'selector="secret"':schema('string')},required:['selector="secret"']}));
  assert.equal(JSON.stringify(value).includes('secret'),false);assert.equal(value[0].path[0],'[field]');
});

test('future required capabilities and execution policies cannot silently escape permission review',()=>{
  const value=review(after=>{after.required_capabilities=['future.private-capability'];after.execution={network_policy:'private-policy-value'};});
  assert.equal(value.permissions_expanded,true);assert.equal(value.permission_review_required,true);
  assert.ok(value.permission_changes.some(change=>change.reason==='capability_added'));
  assert.ok(value.permission_changes.some(change=>change.reason==='execution_policy_changed'));
  assert.equal(JSON.stringify(value).includes('private-capability'),false);assert.equal(JSON.stringify(value).includes('private-policy-value'),false);
  const removed=review(after=>{after.steps=[];});
  assert.ok(removed.permission_changes.some(change=>change.reason==='protected_action_removed'&&change.direction==='reduced'));
  assert.equal(removed.permissions_expanded,false);
});

test('reset session authority requires renewed permission review without disclosing its binding',()=>{
  const definition=base(),beforeConnection=connection(),afterConnection={...connection(),session_generation:'private-session-binding'};
  const value=compareWorkflowChanges({before:definition,after:definition,beforeConnection,afterConnection});
  assert.equal(value.permission_review_required,true);assert.equal(value.breaking,false);
  assert.ok(value.permission_changes.some(change=>change.reason==='browser_binding_changed'));
  assert.equal(JSON.stringify(value).includes('private-session-binding'),false);
});
