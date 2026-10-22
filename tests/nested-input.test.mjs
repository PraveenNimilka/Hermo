import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {inputFieldSchema,inputJsonSchema,inputBindingField,browserInputValue,validateWorkflowContract} from '../server/workflow-contract.mjs';
import {workflowInputSchema,jsonInputSchema,canonicalInput} from '../server/workflow-input.mjs';
import {validateWorkflowSteps} from '../server/workflow-steps.mjs';

const normalized=field=>inputFieldSchema.parse(field);
const definition=inputs=>({inputs,steps:[],outputs:[{name:'result',selector:'#result'}],verifiers:[]});
const object={type:'object',properties:{query:{type:'string',normalization:'trim'},options:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:10,default:3},enabled:{type:'boolean',default:false}}},tags:{type:'array',items:{type:'string'},minItems:0,maxItems:3},comment:{type:'string',nullable:true,required:false},empty:{type:'null',default:null}}};

test('nested inputs retain typed objects, arrays, explicit nulls, normalization and defaults',()=>{
  const d=validateWorkflowContract(definition({request:object}));
  const parsed=workflowInputSchema(d.inputs).parse({request:{query:' books ',options:{},tags:['one'],comment:null}});
  assert.deepEqual(parsed,{request:{query:'books',options:{limit:3,enabled:false},tags:['one'],comment:null,empty:null}});
  for(const request of [{query:'ok',options:{},tags:[],extra:'private'}, {query:'ok',options:{limit:1.5},tags:[]},{query:'ok',options:{enabled:'false'},tags:[]},{query:'ok',options:{},tags:[null]},{query:null,options:{},tags:[]},{query:'ok',tags:[]}])assert.equal(workflowInputSchema(d.inputs).safeParse({request}).success,false);
  assert.deepEqual(workflowInputSchema(d.inputs).parse({request:{query:'ok',options:{},tags:[]}}).request.tags,[]);
});

test('null, omitted values and schema defaults are distinct at every level',()=>{
  const inputs={request:normalized({type:'object',required:false,default:{},properties:{optional:{type:'string',required:false},nullable:{type:'string',nullable:true,default:null},nothing:{type:'null',required:false}}})};
  assert.deepEqual(workflowInputSchema(inputs).parse({}),{request:{nullable:null}});
  assert.deepEqual(workflowInputSchema(inputs).parse({request:{nothing:null}}),{request:{nullable:null,nothing:null}});
  assert.equal(workflowInputSchema(inputs).safeParse({request:null}).success,false);
  assert.equal(inputFieldSchema.safeParse({type:'string',default:null}).success,false);
});

test('coercion is explicit, bounded and never converts structured values into strings',()=>{
  const inputs={amount:normalized({type:'number',coercion:'number',minimum:1,maximum:5}),count:normalized({type:'integer',coercion:'number'}),enabled:normalized({type:'boolean',coercion:'boolean'})};
  assert.deepEqual(workflowInputSchema(inputs).parse({amount:' 2.5 ',count:'3',enabled:'false'}),{amount:2.5,count:3,enabled:false});
  for(const amount of ['', '0x2','NaN','Infinity','1,000',{},[],null])assert.equal(workflowInputSchema(inputs).safeParse({amount,count:3,enabled:true}).success,false);
  for(const enabled of ['FALSE',0,1,'yes'])assert.equal(workflowInputSchema(inputs).safeParse({amount:2,count:3,enabled}).success,false);
  assert.equal(workflowInputSchema({amount:normalized({type:'number'})}).safeParse({amount:'2'}).success,false);
  assert.equal(workflowInputSchema(inputs).safeParse({amount:2,count:1.5,enabled:true}).success,false);
});

test('nested JSON schemas agree with MCP conversion and preserve scalar contract metadata',()=>{
  const inputs={request:normalized(object),quantity:normalized({type:'number',default:2})},schema=inputJsonSchema(inputs),mcp=z.toJSONSchema(workflowInputSchema(inputs),{io:'input'});
  for(const key of ['type','properties','required','additionalProperties'])assert.deepEqual(mcp[key],schema[key]);
  assert.deepEqual(schema.properties.quantity,{type:'number',default:2});
  assert.deepEqual(schema.properties.request.properties.empty,{type:'null',default:null});
  assert.deepEqual(schema.properties.request.properties.tags,{type:'array',items:{type:'string',minLength:1,maxLength:4096},minItems:0,maxItems:3});
  assert.equal(schema.properties.request.additionalProperties,false);
  const coerced=inputJsonSchema({count:normalized({type:'integer',nullable:true,coercion:'number'})}).properties.count;
  assert.equal(coerced['x-hermo-value-type'],'integer');assert.equal(coerced.anyOf[0]['x-hermo-coercion'],'number');
});

test('explicit value paths bind only guaranteed scalar leaves without stringifying collections',()=>{
  const field=normalized({type:'object',properties:{query:{type:'string'},rows:{type:'array',minItems:1,maxItems:2,items:{type:'object',properties:{count:{type:'integer'},enabled:{type:'boolean',default:false}}}}}});
  const input={query:'books',rows:[{count:2}]};
  assert.equal(inputBindingField(field,['rows',0,'count']).type,'integer');
  assert.equal(browserInputValue(field,input,'fill',['rows',0,'count']),'2');
  assert.equal(browserInputValue(field,input,'check',['rows',0,'enabled']),'false');
  assert.equal(browserInputValue(field,input,'fill',['query']),'books');
  for(const path of [[],['rows'],['rows',1,'count'],['missing'],['constructor'],['rows','0','count'],['rows',-1,'count'],['rows',0,'count','too','deep']])assert.throws(()=>inputBindingField(field,path),{message:'INVALID_WORKFLOW_INPUT'});
  for(const value of [null,{},[],{query:'books',rows:[]}])assert.throws(()=>browserInputValue(field,value,'fill',['rows',0,'count']),{message:'INVALID_WORKFLOW_INPUT'});
});

test('bindings reject nullable or optional ancestors and accept validated default paths',()=>{
  for(const field of [{type:'object',required:false,properties:{query:{type:'string'}}},{type:'object',nullable:true,properties:{query:{type:'string'}}},{type:'object',properties:{query:{type:'string',required:false}}},{type:'object',properties:{query:{type:'string',nullable:true}}}])assert.throws(()=>inputBindingField(normalized(field),['query']),{message:'INVALID_WORKFLOW_INPUT'});
  const field=normalized({type:'object',required:false,default:{},properties:{query:{type:'string',default:'books'}}});
  assert.equal(browserInputValue(field,undefined,'fill',['query']),'books');
  assert.throws(()=>browserInputValue({},undefined,'fill'),{message:'INVALID_WORKFLOW_INPUT'});
});

test('shared authoring validation rejects undeclared paths and unbound path configuration',()=>{
  const inputs={request:normalized(object)},options={inputs,origins:['https://example.com']};
  const valid={op:'fill',parameter:'request',value_path:['query'],selector:'#query'};
  assert.deepEqual(validateWorkflowSteps([valid],options),[valid]);
  assert.ok(validateWorkflowContract({...definition(inputs),steps:[valid]}));
  for(const step of [{...valid,value_path:['missing']},{op:'fill',selector:'#query',value:'text',value_path:['query']},{op:'click',selector:'#submit',value_path:['query']},{op:'fill',selector:'#query',parameter:'request'}]){
    assert.throws(()=>validateWorkflowSteps([step],options),{message:'INVALID_WORKFLOW_STEPS'});
    assert.throws(()=>validateWorkflowContract({...definition(inputs),steps:[step]}),{message:'INVALID_WORKFLOW_CONTRACT'});
  }
  assert.throws(()=>validateWorkflowContract({...definition(inputs),steps:[{op:'wait_output',output:'missing',predicate:'nonempty'}]}),{message:'INVALID_WORKFLOW_CONTRACT'});
});

test('schema definitions reject excessive recursion, invalid bounds and unsupported shape controls',()=>{
  let deep={type:'string'};for(let index=0;index<5;index++)deep={type:'object',properties:{child:deep}};
  for(const field of [deep,{type:'array'},{type:'array',items:{type:'string'},minItems:2,maxItems:1},{type:'object',properties:Object.fromEntries(Array.from({length:17},(_,index)=>['field_'+index,{type:'string'}]))},{type:'object',properties:{constructor:{type:'string'}}},{type:'object',properties:{},additionalProperties:true},{type:'string',coercion:'number'},{type:'integer',maximum:Number.MAX_SAFE_INTEGER+1},{type:'integer',default:1.5},{type:'array',items:{type:'string'},default:[null]}])assert.equal(inputFieldSchema.safeParse(field).success,false);
});

test('JSON transport rejects prototype keys, cycles, accessors, oversized values and deep bodies',()=>{
  const cycle={};cycle.child=cycle;
  let getterCalls=0;const getter={};Object.defineProperty(getter,'private',{enumerable:true,get(){getterCalls++;return 'private';}});
  const array=[];Object.defineProperty(array,0,{enumerable:true,get(){getterCalls++;return 'private';}});
  let deep={};for(let index=0;index<8;index++)deep={child:deep};
  for(const value of [cycle,getter,array,deep,JSON.parse('{"constructor":{"private":"x"}}'),JSON.parse('{"__proto__":{"polluted":true}}'),{value:'x'.repeat(4097)},{value:Array(101).fill(1)},{value:NaN},{value:1n},Object.create({inherited:'private'}),{value:'💡'.repeat(4096),other:'💡'.repeat(4096)}])assert.equal(jsonInputSchema.safeParse(value).success,false);
  assert.equal(getterCalls,0);assert.equal({}.polluted,undefined);
  assert.equal(jsonInputSchema.safeParse({request:{enabled:false,items:[null,1,'text']}}).success,true);
});

test('default expansion must fit the same bounded JSON envelope as submitted values',()=>{
  const field=normalized({type:'array',minItems:0,maxItems:100,items:{type:'object',properties:{text:{type:'string',default:'x'.repeat(4096)}}}});
  assert.equal(workflowInputSchema({rows:field}).safeParse({rows:Array.from({length:10},()=>({}))}).success,false);
  assert.equal(workflowInputSchema({rows:field}).safeParse({rows:[{}]}).success,true);
});

test('nested idempotency normalization sorts only object keys and preserves scalar digest bytes',()=>{
  const digest=value=>createHash('sha256').update(value).digest('hex'),legacy=value=>JSON.stringify(Object.keys(value).sort().map(key=>[key,value[key]])),current=value=>JSON.stringify(Object.keys(value).sort().map(key=>[key,canonicalInput(value[key])]));
  assert.equal(digest(legacy({query:'books',count:2,enabled:false})),digest(current({query:'books',count:2,enabled:false})));
  assert.equal(current({request:{query:'books',options:{count:2,enabled:false}}}),current({request:{options:{enabled:false,count:2},query:'books'}}));
  assert.notEqual(current({request:{rows:[1,2]}}),current({request:{rows:[2,1]}}));
});
