import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {inputFieldSchema,inputJsonSchema} from '../server/workflow-contract.mjs';
import {workflowInputSchema} from '../server/workflow-input.mjs';

// Exercise the actual client helpers rather than maintaining a second copy of
// form parsing in a fixture. No browser actions are simulated by these tests.
const compiled=await build({stdin:{contents:"export {inputDefinitionFromSchema,initialInputValues,typedInput,exampleInput} from './src/WorkflowContract.tsx';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,jsx:'automatic'});
const {inputDefinitionFromSchema,initialInputValues,typedInput,exampleInput}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const original={request:inputFieldSchema.parse({type:'object',properties:{query:{type:'string',normalization:'trim',default:'books'},rows:{type:'array',minItems:1,maxItems:2,items:{type:'object',properties:{count:{type:'integer',minimum:1,maximum:10,default:2},enabled:{type:'boolean',coercion:'boolean',default:false}}}},comment:{type:'string',nullable:true,default:null},nothing:{type:'null',required:false}}})};
const schema=inputJsonSchema(original),fromSchema=Object.fromEntries(Object.entries(schema.properties).map(([name,field])=>[name,inputDefinitionFromSchema(field,schema.required.includes(name))]));

test('published recursive schema becomes usable client definitions without losing null or defaults',()=>{
  assert.equal(fromSchema.request.properties.comment.default,null);
  assert.equal(fromSchema.request.properties.comment.nullable,true);
  assert.equal(fromSchema.request.properties.rows.items.properties.enabled.coercion,'boolean');
  assert.equal(fromSchema.request.properties.nothing.required,false);
  const examples=exampleInput(fromSchema),values=initialInputValues(fromSchema),parsed=typedInput(fromSchema,values);
  assert.deepEqual(parsed.errors,{});assert.deepEqual(parsed.input,examples);
  assert.deepEqual(workflowInputSchema(original).parse(parsed.input),parsed.input);
});

test('JSON form parsing validates structure and explicit coercion before admission',()=>{
  const value={request:JSON.stringify({query:' lamps ',rows:[{count:3,enabled:'false'}],comment:null})},parsed=typedInput(fromSchema,value);
  assert.deepEqual(parsed.errors,{});assert.deepEqual(parsed.input,{request:{query:'lamps',rows:[{count:3,enabled:false}],comment:null}});
  for(const request of ['{broken','null',JSON.stringify({query:'ok',rows:[],comment:null}),JSON.stringify({query:'ok',rows:[{count:1.5,enabled:false}],comment:null}),'{"query":"ok","rows":[{"count":2,"enabled":false}],"constructor":"private"}'])assert.ok(typedInput(fromSchema,{request}).errors.request);
});

test('nullable scalar and explicit null use JSON while omission stays absent',()=>{
  const fields={text:{type:'string',nullable:true,default:null},nothing:{type:'null'},optional:{type:'array',items:{type:'string'},required:false}};
  assert.equal(initialInputValues(fields).text,'null');assert.equal(initialInputValues(fields).nothing,'null');
  const parsed=typedInput(fields,{text:'"hello"',nothing:'null',optional:'[]'},{optional:true});
  assert.deepEqual(parsed.errors,{});assert.deepEqual(parsed.input,{text:'hello',nothing:null});
  assert.ok(typedInput(fields,{text:'hello',nothing:'"null"',optional:'[]'}).errors.nothing);
});

test('nullable coercion schema retains its canonical type and uses only explicit conversions',()=>{
  const field=inputFieldSchema.parse({type:'integer',coercion:'number',nullable:true,default:null}),json=inputJsonSchema({count:field}).properties.count,definition=inputDefinitionFromSchema(json,false);
  assert.equal(definition.type,'integer');assert.equal(definition.coercion,'number');assert.equal(definition.default,null);
  assert.deepEqual(typedInput({count:definition},{count:'"3"'}).input,{count:3});
  assert.ok(typedInput({count:definition},{count:'"3.5"'}).errors.count);
  assert.deepEqual(typedInput({count:definition},{count:'null'}).input,{count:null});
});

test('legacy scalar input forms retain their values and validation behavior',()=>{
  const fields={query:{type:'string',normalization:'trim',minLength:2},count:{type:'number',default:0},enabled:{type:'boolean',default:false}};
  assert.deepEqual(initialInputValues(fields),{query:'',count:'0',enabled:'false'});
  assert.deepEqual(typedInput(fields,{query:' books ',count:'2.5',enabled:'false'}),{input:{query:'books',count:2.5,enabled:false},errors:{}});
  assert.ok(typedInput(fields,{query:'x',count:'NaN',enabled:'yes'}).errors.count);
});
