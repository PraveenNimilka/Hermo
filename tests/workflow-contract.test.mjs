import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {workflowInputSchema} from '../server/workflow-input.mjs';
import {PATH_INPUT_PATTERN,inputFieldSchema,outputFieldSchema,validateWorkflowContract,inputJsonSchema,outputJsonSchema,convertOutputs,browserInputValue} from '../server/workflow-contract.mjs';
import {validateVerifiers,verifyResult} from '../server/verification.mjs';

const definition=(inputs={},extra={})=>({inputs,steps:[],outputs:[{name:'result',selector:'#result',frame_path:['#frame'],read_mode:'last'}],verifiers:[{kind:'nonempty',output:'result'}],version:'unchanged-content-hash',...extra});
const invalid=value=>assert.throws(()=>validateWorkflowContract(value),error=>error.message==='INVALID_WORKFLOW_CONTRACT'&&Object.keys(error).length===0);

test('scalar input contracts normalize opt-in strings and preserve scalar types',()=>{
  const d=validateWorkflowContract(definition({query:{normalization:'trim',minLength:2,maxLength:20},quantity:{type:'number',minimum:0,maximum:10},enabled:{type:'boolean'}}));
  assert.deepEqual(workflowInputSchema(d.inputs).parse({query:'  value  ',quantity:2.5,enabled:false}),{query:'value',quantity:2.5,enabled:false});
  assert.equal(d.inputs.query.type,'string');
  assert.equal(d.inputs.query.required,true);
  for(const input of [{query:'a',quantity:2,enabled:true},{query:'ok',quantity:'2',enabled:true},{query:'ok',quantity:2,enabled:'true'},{query:'ok',quantity:Infinity,enabled:false},{query:'ok',quantity:11,enabled:false},{query:'ok',quantity:2,enabled:false,extra:'unexpected'}])assert.equal(workflowInputSchema(d.inputs).safeParse(input).success,false);
});

test('optional values and defaults share the actual request validation and browser semantics',()=>{
  const d=validateWorkflowContract(definition({query:{required:false},quantity:{type:'number',default:3,minimum:1,maximum:5},enabled:{type:'boolean',required:false,default:false},label:{normalization:'trim',default:' hello '}}));
  assert.deepEqual(workflowInputSchema(d.inputs).parse({}),{quantity:3,enabled:false,label:'hello'});
  assert.equal(d.inputs.label.default,'hello');
  assert.equal(browserInputValue(d.inputs.query,undefined,'fill'),'');
  assert.equal(browserInputValue(d.inputs.quantity,3,'fill'),'3');
  assert.equal(browserInputValue(d.inputs.enabled,false,'check'),'false');
  assert.equal(browserInputValue(d.inputs.enabled,undefined,'check'),'false');
  for(const operation of ['select','check'])assert.throws(()=>browserInputValue(d.inputs.query,undefined,operation),{message:'INVALID_WORKFLOW_INPUT'});
  assert.throws(()=>browserInputValue({required:true},undefined,'fill'),{message:'INVALID_WORKFLOW_INPUT'});
  for(const value of [null,{},[],NaN,Infinity])assert.throws(()=>browserInputValue({},value,'fill'),{message:'INVALID_WORKFLOW_INPUT'});
  // Even an unchecked historical definition cannot bypass constraints via a default.
  assert.equal(workflowInputSchema({quantity:{type:'number',minimum:1,default:0}}).safeParse({}).success,false);
});

test('trim runs before configured length constraints for requests and defaults',()=>{
  const d=validateWorkflowContract(definition({query:{normalization:'trim',minLength:2,maxLength:3,default:'  hi  ',example:'  hi  '}}));
  assert.equal(d.inputs.query.default,'hi');assert.equal(d.inputs.query.example,'hi');
  assert.deepEqual(workflowInputSchema(d.inputs).parse({query:'  hi  '}),{query:'hi'});
  assert.deepEqual(workflowInputSchema(d.inputs).parse({}),{query:'hi'});
  assert.equal(workflowInputSchema(d.inputs).safeParse({query:' four '}).success,false);
});

test('checkbox text defaults and examples must be executable boolean representations',()=>{
  const steps=[{op:'check',parameter:'enabled'}];
  for(const key of ['default','example'])invalid(definition({enabled:{type:'string',[key]:'yes'}},{steps}));
  for(const value of ['true','false'])assert.ok(validateWorkflowContract(definition({enabled:{type:'string',required:false,default:value}},{steps})));
});

test('string enums are bounded, normalized, unique, and checked after normalization',()=>{
  const d=validateWorkflowContract(definition({state:{normalization:'trim',enum:[' open ','closed'],default:' open ',example:'closed'}}));
  assert.deepEqual(d.inputs.state.enum,['open','closed']);
  assert.equal(d.inputs.state.default,'open');
  assert.deepEqual(workflowInputSchema(d.inputs).parse({state:' open '}),{state:'open'});
  assert.equal(workflowInputSchema(d.inputs).safeParse({state:'unknown-secret-state'}).success,false);
  for(const field of [{enum:[]},{enum:Array.from({length:51},(_,i)=>String(i))},{enum:['same','same']},{normalization:'trim',enum:[' same ','same']},{enum:['valid'],default:'other'},{enum:['valid'],example:'other'},{enum:[''],minLength:1}])invalid(definition({state:field}));
});

test('author configuration rejects invalid constraints and mismatched defaults or examples',()=>{
  const cases=[{type:'array'},{required:'true'},{unknown:true},{type:'string',minimum:1},{type:'number',normalization:'trim'},{type:'boolean',enum:['true']},{type:'number',minLength:1},{type:'boolean',default:'false'},{type:'number',example:'2'},{type:'number',default:1,minimum:2},{type:'number',maximum:1,example:2},{type:'number',minimum:3,maximum:2},{type:'number',minimum:Infinity},{minLength:-1},{minLength:0},{maxLength:0},{maxLength:4097},{minLength:4,maxLength:2},{minLength:2,default:'a'},{maxLength:2,example:'abc'},{pattern:'unsafe-regex'},{normalization:'lowercase'},{default:null}];
  for(const field of cases)invalid(definition({value:field}));
  assert.equal(inputFieldSchema.safeParse({type:'number',default:2,example:3,minimum:1,maximum:4}).success,true);
  assert.equal(outputFieldSchema.safeParse({name:'result',type:'number',required:false}).success,false);
  assert.equal(outputFieldSchema.safeParse({name:'result',type:'array'}).success,false);
  assert.equal(outputFieldSchema.safeParse({name:'result',selector:'#result'}).success,false);
  invalid(definition({}, {outputs:[{name:'result',required:false}]}));
  invalid(definition({}, {outputs:[{name:'result'},{name:'result'}]}));
  invalid(definition({'invalid-name':{}}));
});

test('path parameters and select/check operations cannot consume unsafe or absent values',()=>{
  const path={op:'navigate',path_parameter:'item_id',template:'https://example.com/items/{{item_id}}'};
  const safe={item_id:{pattern:PATH_INPUT_PATTERN}};
  assert.equal(validateWorkflowContract(definition(safe,{steps:[path]})).inputs.item_id.required,true);
  invalid(definition({item_id:{pattern:PATH_INPUT_PATTERN,minLength:121}},{steps:[path]}));
  for(const field of [{},{type:'number'},{pattern:PATH_INPUT_PATTERN,required:false},{pattern:PATH_INPUT_PATTERN,default:'bad/path'}])invalid(definition({item_id:field},{steps:[path]}));
  for(const op of ['select','check']){
    invalid(definition({enabled:{required:false}},{steps:[{op,parameter:'enabled'}]}));
    assert.ok(validateWorkflowContract(definition({enabled:{required:false,default:'false'}},{steps:[{op,parameter:'enabled'}]})));
  }
  for(const field of [{type:'boolean'},{enum:['true','false']},{}])assert.ok(validateWorkflowContract(definition({enabled:field},{steps:[{op:'check',parameter:'enabled'}]})));
  for(const field of [{type:'number'},{enum:['yes','no']}])invalid(definition({enabled:field},{steps:[{op:'check',parameter:'enabled'}]}));
  for(const parameter of ['absent','constructor'])invalid(definition({}, {steps:[{op:'fill',parameter}]}));
});

test('correlation requires an input guaranteed to exist and preserves verifier compatibility',()=>{
  const rule={kind:'equals_input',output:'result',input:'query'};
  invalid(definition({query:{required:false}},{verifiers:[rule]}));
  invalid(definition({},{verifiers:[rule]}));
  invalid(definition({},{verifiers:[{output:'result',input:'constructor'}]}));
  assert.ok(validateWorkflowContract(definition({query:{required:false,default:'value'}},{verifiers:[rule]})));
  assert.equal(validateVerifiers([rule],[{name:'result'}],{query:{required:false}}),false);
  assert.equal(validateVerifiers([rule],[{name:'result'}],{query:{required:false,default:'value'}}),true);
  assert.equal(validateVerifiers([{output:'result',input:'query'}],[{name:'result'}],{query:{}}),true);
});

test('contract validation preserves locator metadata and version without mutating the definition',()=>{
  const original=definition({quantity:{type:'number',example:2}},{custom_metadata:{safe:true}}),snapshot=structuredClone(original);
  const validated=validateWorkflowContract(original);
  assert.deepEqual(original,snapshot);
  assert.equal(validated.version,original.version);
  assert.equal(validated.custom_metadata,original.custom_metadata);
  assert.deepEqual(validated.outputs[0],{...original.outputs[0],type:'string',required:true});
  assert.equal(validated.steps,original.steps);
  assert.deepEqual(validateWorkflowContract(definition()).inputs,{});
  assert.deepEqual(workflowInputSchema({}).parse({}),{});
  assert.equal(workflowInputSchema({}).safeParse({extra:'value'}).success,false);
});

test('generated JSON schemas describe scalar types, constraints, defaults, and required values',()=>{
  const d=validateWorkflowContract(definition({query:{normalization:'trim',minLength:2,maxLength:50,enum:['open','closed'],example:'open'},quantity:{type:'number',minimum:0,maximum:5,default:2},enabled:{type:'boolean',required:false},item_id:{pattern:PATH_INPUT_PATTERN}}));
  const schema=inputJsonSchema(d.inputs);
  assert.deepEqual(schema.required,['query','item_id']);
  assert.deepEqual(schema.properties.query,{type:'string',minLength:2,maxLength:50,enum:['open','closed'],description:'Leading and trailing whitespace is trimmed before validation.','x-hermo-normalization':'trim',examples:['open']});
  assert.deepEqual(schema.properties.quantity,{type:'number',minimum:0,maximum:5,default:2});
  assert.deepEqual(schema.properties.enabled,{type:'boolean'});
  assert.equal(schema.properties.item_id.pattern,PATH_INPUT_PATTERN);
  assert.equal(schema.properties.item_id.maxLength,120);
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(inputJsonSchema({}),{type:'object',properties:{},required:[],additionalProperties:false});
  const output=outputJsonSchema([{name:'title'},{name:'price',type:'number'},{name:'available',type:'boolean'},{name:'website',type:'url'}]);
  assert.deepEqual(output.required,['title','price','available','website']);
  assert.equal(output.properties.price.type,'number');assert.equal(output.properties.available.type,'boolean');assert.equal(output.properties.website.format,'uri');
  // MCP's input-schema conversion must support normalization and default pipelines.
  const mcp=z.toJSONSchema(workflowInputSchema(d.inputs),{io:'input'});
  assert.equal(mcp.properties.quantity.type,'number');assert.equal(mcp.properties.quantity.default,2);
  for(const key of ['type','minLength','maxLength','enum','description'])assert.deepEqual(mcp.properties.query[key],schema.properties.query[key]);
  assert.equal(mcp.properties.item_id.pattern,schema.properties.item_id.pattern);
  assert.deepEqual(mcp.required,schema.required);
});

test('strict output conversion accepts decimal/exponent numbers, booleans, URLs, and exact raw text',()=>{
  const fields=[{name:'amount',type:'number'},{name:'available',type:'boolean'},{name:'website',type:'url'},{name:'title',type:'string'}];
  assert.deepEqual(convertOutputs(fields,{amount:' -1.25e+2 ',available:' false ',website:' https://example.com/a?x=1#part ',title:' keep text ',unrelated:'excluded'}),{amount:-125,available:false,website:'https://example.com/a?x=1#part',title:' keep text '});
  for(const [raw,expected]of [['0',0],['+.5',.5],['1.',1],['2E-2',.02]])assert.equal(convertOutputs([{name:'value',type:'number'}],{value:raw}).value,expected);
  assert.equal(convertOutputs([{name:'available',type:'boolean'}],{available:'true'}).available,true);
  assert.equal(convertOutputs([{name:'website',type:'url'}],{website:'HTTPS://example.com/'}).website,'HTTPS://example.com/');
});

test('invalid extraction returns safe typed reasons without disclosing extracted data',()=>{
  const check=(type,raw,reason)=>assert.throws(()=>convertOutputs([{name:'result',type}],{result:raw}),error=>{
    assert.equal(error.message,'VERIFICATION_FAILED');assert.deepEqual(error.verification,{output:'result',reason});
    if(typeof raw==='string'&&raw.trim())assert.equal(JSON.stringify(error).includes(raw),false);
    return true;
  });
  for(const raw of ['$123-secret','28 °C','1,234','0x10','Infinity','NaN','1e999','1 2','secret123'])check('number',raw,'invalid_number');
  for(const raw of ['TRUE','False','1','0','yes','secret'])check('boolean',raw,'invalid_boolean');
  for(const raw of ['https://user:secret@example.com','javascript:secret()','file:///secret','https:example.com','https://example.com/a b','https://example.com/\nsecret'])check('url',raw,'invalid_url');
  for(const raw of ['', ' \n ',undefined,null,2,false])check('string',raw,'missing_output');
});

test('verification checks raw observations before typed conversion and compares scalar input text',()=>{
  const d=definition({quantity:{type:'number'}},{outputs:[{name:'result',type:'number'}],verifiers:[{kind:'equals_input',output:'result',input:'quantity'}]});
  const verification=verifyResult(d,{result:'2'},{quantity:2},'authorized_origin');
  assert.deepEqual(verification.checks,['authorized_origin','nonempty_outputs','result_matches_quantity','output_schema']);
  assert.throws(()=>verifyResult(d,{result:'2.0'},{quantity:2},'origin'),error=>error.verification.reason==='input_mismatch');
  assert.throws(()=>verifyResult(d,{result:'2'},{},'origin'),error=>error.verification.reason==='input_mismatch');
  const boolean=definition({enabled:{type:'boolean'}},{outputs:[{name:'result',type:'boolean'}],verifiers:[{output:'result',input:'enabled'}]});
  assert.ok(verifyResult(boolean,{result:'false'},{enabled:false},'origin').checks.includes('output_schema'));
  assert.throws(()=>verifyResult(definition({}, {outputs:[{name:'result',type:'number'}]}),{result:'private-invalid'},{},'origin'),error=>error.verification.reason==='invalid_number');
});

test('legacy input patterns, raw unit outputs, and verification checks remain compatible',()=>{
  const old={identifier:{type:'string',pattern:'^[A-Za-z0-9_-]+$'},freeform:{}};
  assert.deepEqual(workflowInputSchema(old).parse({identifier:'ORD-1',freeform:'\nkeep whitespace\n'}),{identifier:'ORD-1',freeform:'\nkeep whitespace\n'});
  assert.equal(workflowInputSchema(old).safeParse({identifier:'x'.repeat(121),freeform:'valid'}).success,false);
  invalid(definition(old));
  const legacy=definition({}, {outputs:[{name:'result'}],verifiers:[{kind:'number',output:'result',unit:'°C'}]});
  assert.deepEqual(verifyResult(legacy,{result:'28 °C'},{},'public_source_origin').checks,['public_source_origin','nonempty_outputs','result_number']);
  assert.deepEqual(convertOutputs(legacy.outputs,{result:' 28 °C '}),{result:' 28 °C '});
  assert.throws(()=>verifyResult(legacy,{result:'28 °F'},{},'origin'),error=>error.verification.reason==='unit_mismatch');
});
