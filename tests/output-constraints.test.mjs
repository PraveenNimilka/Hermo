import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOutputMappings,browserOutputMapping} from '../server/output-mappings.mjs';
import {convertOutputs,validateConvertedOutputs,outputJsonSchema,validateWorkflowContract} from '../server/workflow-contract.mjs';
import {safeOutputPattern} from '../server/output-constraints.mjs';

const mapping=field=>validateOutputMappings([{name:'result',selector:'#result',...field}]);
const convert=(field,value)=>convertOutputs(mapping(field),{result:value}).result;
const rejects=(fn,reason,path,keyword)=>assert.throws(fn,error=>{
  assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification.reason,reason);
  if(path)assert.deepEqual(error.verification.path,path);
  if(keyword)assert.equal(error.verification.keyword,keyword);
  return true;
});

test('integer constraints are enforced after strict decimal conversion and represented in JSON Schema',()=>{
  const fields=mapping({type:'integer',minimum:0,maximum:3,enum:[0,2]});
  assert.equal(convertOutputs(fields,{result:'2.0'}).result,2);
  assert.equal(convertOutputs(fields,{result:'0'}).result,0);
  for(const value of ['2.5','9007199254740992'])rejects(()=>convertOutputs(fields,{result:value}),'invalid_integer',['result'],'type');
  rejects(()=>convertOutputs(fields,{result:'-1'}),'below_minimum',['result'],'minimum');
  rejects(()=>convertOutputs(fields,{result:'4'}),'above_maximum',['result'],'maximum');
  rejects(()=>convertOutputs(fields,{result:'1'}),'enum_mismatch',['result'],'enum');
  assert.deepEqual(outputJsonSchema(fields).properties.result,{type:'integer',minimum:0,maximum:3,enum:[0,2]});
  assert.deepEqual(outputJsonSchema(mapping({type:'integer'})).properties.result,{type:'integer',minimum:Number.MIN_SAFE_INTEGER,maximum:Number.MAX_SAFE_INTEGER});
  assert.equal(convert({type:'number',enum:[1.25]},'1.25'),1.25);
  assert.equal(convert({type:'boolean',enum:[false]},'false'),false);
  rejects(()=>convert({type:'boolean',enum:[false]},'true'),'enum_mismatch');
});

test('invalid type-specific constraints and impossible definitions fail before persistence',()=>{
  const invalid=[{type:'object',fields:[{name:'field',selector:'p'}],enum:['x']},{type:'string',minimum:1},{type:'number',maxLength:2},{type:'string',uniqueItems:true},{type:'number',enum:['1']},{type:'boolean',enum:[0]},{type:'integer',enum:[1.5]},{type:'string',enum:['x','x']},{type:'number',minimum:3,maximum:2},{type:'string',minLength:3,maxLength:2},{type:'url',format:'date'},{type:'string',format:'date',media_type:'file'},{type:'string',enum:['']},{type:'integer',minimum:Number.MAX_SAFE_INTEGER+1},{type:'string',format:'date',enum:['2023-02-29']},{type:'url',enum:['ftp://example.com']}];
  for(const field of invalid)assert.throws(()=>mapping(field),{message:'INVALID_OUTPUT_MAPPINGS'},JSON.stringify(field));
});

test('string constraints preserve legacy raw text, count Unicode code points, and validate exact enum values',()=>{
  assert.equal(convert({type:'string'},' keep text '),' keep text ');
  assert.equal(convert({type:'string',minLength:1,maxLength:1},'😀'),'😀');
  rejects(()=>convert({type:'string',minLength:2},'😀'),'string_too_short',['result'],'minLength');
  rejects(()=>convert({type:'string',maxLength:2},'abc'),'string_too_long',['result'],'maxLength');
  assert.equal(convert({type:'string',enum:[' padded ']},' padded '),' padded ');
  rejects(()=>convert({type:'string',enum:[' padded ']},'padded'),'enum_mismatch');
});

test('date, date-time and time formats validate calendar and qualified RFC3339 values',()=>{
  for(const value of ['2024-02-29','2000-02-29'])assert.equal(convert({format:'date'},value),value);
  for(const value of ['2023-02-29','1900-02-29','2024-04-31','2024-2-01','2024-01-01T00:00:00Z'])rejects(()=>convert({format:'date'},value),'invalid_format');
  for(const value of ['2024-02-29T23:59:59Z','2024-02-29T23:59:59.123+05:30'])assert.equal(convert({format:'date-time'},value),value);
  for(const value of ['2024-02-30T23:59:59Z','2024-02-29T24:00:00Z','2024-02-29T23:59:59','2024-02-29T23:59Z','2024-02-29T23:59:59+0500'])rejects(()=>convert({format:'date-time'},value),'invalid_format');
  for(const value of ['23:59:59Z','12:30:00.123+05:30'])assert.equal(convert({format:'time'},value),value);
  for(const value of ['24:00:00Z','12:30:00','12:30Z','12:30:00+0500'])rejects(()=>convert({format:'time'},value),'invalid_format');
  assert.equal(outputJsonSchema(mapping({format:'time'})).properties.result.format,'time');
});

test('fixed-token anchored patterns reject unsafe regex syntax and require a complete match',()=>{
  for(const pattern of ['^[A-Z]{2}\\d{3}$','^item-[a-z]{4}$','^a\\.b$','^[^x]{2}$','^\\w{3}$'])assert.equal(safeOutputPattern(pattern),true,pattern);
  for(const pattern of ['a','a$','^a','^a+$','^a*$','^a?$','^(a+)+$','^(a|aa){3}$','^a{1,3}$','^a{0}$','^a{4097}$','^\\1$','^(?=a)a$','^.$','^[]$','^[z-a]$','^a{2}{2}$']){
    assert.equal(safeOutputPattern(pattern),false,pattern);assert.throws(()=>mapping({pattern}),{message:'INVALID_OUTPUT_MAPPINGS'});
  }
  assert.equal(convert({pattern:'^[A-Z]{2}\\d{3}$'},'AB123'),'AB123');
  rejects(()=>convert({pattern:'^[A-Z]{2}\\d{3}$'},'AB123\n'),'pattern_mismatch',['result'],'pattern');
  rejects(()=>convert({pattern:'^[A-Z]{2}\\d{3}$'},'AB12'),'pattern_mismatch');
});

test('nested conversion errors identify array indices, and uniqueItems compares converted complete values',()=>{
  const fields=mapping({type:'array',uniqueItems:true,items:{type:'object',fields:[{name:'price',type:'integer',minimum:0,selector:'.price'},{name:'label',selector:'.label',required:false}]}});
  rejects(()=>convertOutputs(fields,{result:[{price:'1'},{price:'-2'}]}),'below_minimum',['result',1,'price'],'minimum');
  rejects(()=>convertOutputs(fields,{result:[{price:'1'},{price:'1.0'}]}),'duplicate_items',['result',1],'uniqueItems');
  assert.deepEqual(convertOutputs(fields,{result:[{price:'1',label:'a'},{price:'1',label:'b'}]}),{result:[{price:1,label:'a'},{price:1,label:'b'}]});
  const schema=outputJsonSchema(fields).properties.result;assert.equal(schema.uniqueItems,true);assert.equal(schema.items.properties.price.type,'integer');
  const browser=browserOutputMapping(fields[0]);assert.equal(browser.items.fields[0].type,'number');assert.equal(fields[0].items.fields[0].type,'integer');
});

test('the final trusted gate validates converted structures without coercion or undeclared properties',()=>{
  const fields=mapping({type:'object',fields:[{name:'count',selector:'.count',type:'integer',minimum:0},{name:'flag',selector:'.flag',type:'boolean'},{name:'note',selector:'.note',required:false},{name:'rating',selector:'.rating',type:'number',nullable:true}]});
  const good={result:{count:0,flag:false,rating:null}};assert.equal(validateConvertedOutputs(fields,good),good);
  rejects(()=>validateConvertedOutputs(fields,{result:{...good.result,count:'0'}}),'invalid_number',['result','count'],'type');
  rejects(()=>validateConvertedOutputs(fields,{result:{...good.result,flag:'false'}}),'invalid_boolean',['result','flag'],'type');
  rejects(()=>validateConvertedOutputs(fields,{result:{...good.result,count:-1}}),'below_minimum',['result','count'],'minimum');
  rejects(()=>validateConvertedOutputs(fields,{result:{...good.result,secret:'must not leak'}}),'invalid_structure',['result'],'additionalProperties');
  rejects(()=>validateConvertedOutputs(fields,{...good,extra:'must not leak'}),'invalid_structure',['result'],'additionalProperties');
  rejects(()=>validateConvertedOutputs(fields,{result:{count:0,flag:false}}),'missing_output',['result','rating'],'required');
  const optional=mapping({required:false,nullable:true});assert.deepEqual(convertOutputs(optional,{}),{});assert.deepEqual(convertOutputs(optional,{result:''}),{result:null});
  assert.equal(validateConvertedOutputs(optional,{}).result,undefined);
  rejects(()=>validateConvertedOutputs(optional,{result:''}),'missing_output',['result'],'required');
  rejects(()=>validateConvertedOutputs(optional,{result:undefined}),'invalid_structure',['result'],'type');
  rejects(()=>validateConvertedOutputs(mapping({type:'array',items:{type:'string'}}),{result:new Array(1)}),'missing_output',['result',0],'required');
  const definition={inputs:{},outputs:fields,steps:[],verifiers:[]};assert.equal(validateWorkflowContract(definition).outputs[0].fields[0].type,'integer');
});
