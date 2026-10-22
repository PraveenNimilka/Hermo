import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyResult} from '../server/verification.mjs';
import {validateWorkflowContract} from '../server/workflow-contract.mjs';
import {validateVerifierReferences} from '../server/verification-rules.mjs';

const outputs=[
  {name:'rows',type:'array',selector:'.row',items:{type:'object',fields:[
    {name:'code',type:'string',selector:'.code',required:false},
    {name:'amount',type:'number',selector:'.amount'},
    {name:'details',type:'object',fields:[{name:'label',type:'string',selector:'.label'}]}
  ]}},
  {name:'limit',type:'number',selector:'#limit'},
  {name:'label',type:'string',selector:'#label'}
];
const row=(code,amount,label='Ready')=>({...code===undefined?{}:{code},amount:String(amount),details:{label}});
const definition=verifiers=>({version:'v1',steps:[],inputs:{},outputs,verifiers});
const verify=(verifiers,rows=[row('AA',2),row('BB',5)],extra={})=>verifyResult(definition(verifiers),{rows,limit:'10',label:'Ready',...extra},{},'public_source_origin');
const fails=(fn,reason,path)=>assert.throws(fn,error=>{
  assert.equal(error.message,'VERIFICATION_FAILED');assert.equal(error.verification.reason,reason);
  if(path)assert.deepEqual(error.verification.path,path);return true;
});

test('row quantifiers distinguish all, some and exactly one using normalized numbers',()=>{
  const rule={kind:'rows',output:'rows',path:['amount'],operator:'gt',value:3};
  for(const quantifier of ['some','exactly_one'])assert.ok(verify([{...rule,quantifier}]).checks.includes('rows_rows_'+quantifier));
  fails(()=>verify([{...rule,quantifier:'all'}]),'row_mismatch',['rows',0,'amount']);
  assert.ok(verify([{...rule,value:1,quantifier:'all'}]));
  fails(()=>verify([{...rule,value:1,quantifier:'exactly_one'}]),'row_mismatch');
  fails(()=>verify([{...rule,value:20,quantifier:'some'}]),'row_mismatch');
  const empty={...definition([{...rule,quantifier:'all'}]),outputs:[{...outputs[0],minItems:0},...outputs.slice(1)]};
  fails(()=>verifyResult(empty,{rows:[],limit:'10',label:'Ready'},{},'origin'),'row_mismatch',['rows']);
});

test('nested row paths and indexed cross-output comparisons use declared scalar types',()=>{
  const nested={kind:'rows',output:'rows',path:['details','label'],operator:'contains',value:'Read',quantifier:'all'};
  assert.equal(validateVerifierReferences([nested],outputs,{}),true);assert.ok(verify([nested]));
  const compare={kind:'compare',output:'rows',path:[1,'amount'],operator:'lt',other_output:'limit'};
  assert.equal(validateVerifierReferences([compare],outputs,{}),true);assert.ok(verify([compare]));
  fails(()=>verify([compare],undefined,{limit:'4'}),'comparison_failed',['rows',1,'amount']);
  const text={kind:'compare',output:'rows',path:[0,'details','label'],operator:'eq',other_output:'label'};
  assert.ok(verify([text]));fails(()=>verify([text],undefined,{label:'Other'}),'comparison_failed');
});

test('unique keys reject duplicate and missing optional values rather than treating them as distinct',()=>{
  const unique={kind:'unique',output:'rows',path:['code']};
  assert.ok(verify([unique]));
  fails(()=>verify([unique],[row('AA',2),row('AA',5)]),'duplicate_value',['rows',1,'code']);
  fails(()=>verify([unique],[row('AA',2),row(undefined,5)]),'missing_output',['rows',1,'code']);
  const missing={kind:'rows',output:'rows',path:['code'],operator:'ne',value:'AA',quantifier:'all'};
  fails(()=>verify([missing],[row(undefined,2)]),'row_mismatch',['rows',0,'code']);
});

test('whole-row uniqueness compares object contents independently of property order',()=>{
  const duplicate={details:{label:'Ready'},amount:'2',code:'AA'};
  fails(()=>verify([{kind:'unique',output:'rows'}],[row('AA',2),duplicate]),'duplicate_value',['rows',1]);
  assert.ok(verify([{kind:'unique',output:'rows'}],[row('AA',2),row('AA',3)]));
});

test('missing nested comparison values fail even for not-equal operators',()=>{
  const rule={kind:'compare',output:'rows',path:[0,'code'],operator:'ne',other_output:'label'};
  assert.equal(validateVerifierReferences([rule],outputs,{}),true);
  fails(()=>verify([rule],[row(undefined,2)]),'comparison_failed',['rows',0,'code']);
});

test('invalid references, paths, operators and mismatched types are rejected before execution',()=>{
  const cases=[
    {kind:'unique',output:'limit'},
    {kind:'unique',output:'rows',path:['missing']},
    {kind:'rows',output:'rows',path:['amount'],operator:'gt',value:'3',quantifier:'all'},
    {kind:'rows',output:'rows',path:['code'],operator:'gt',value:'AA',quantifier:'all'},
    {kind:'rows',output:'rows',path:['amount'],operator:'contains',value:2,quantifier:'all'},
    {kind:'rows',output:'rows',path:['details','missing'],operator:'eq',value:'Ready',quantifier:'all'},
    {kind:'compare',output:'limit',operator:'eq',other_output:'label'},
    {kind:'compare',output:'rows',path:[100,'amount'],operator:'lt',other_output:'limit'},
    {kind:'compare',output:'rows',path:['amount'],operator:'lt',other_output:'limit'},
    {kind:'compare',output:'limit',operator:'eq',other_output:'missing'},
    {kind:'rows',output:'rows',path:['amount'],operator:'eq',value:2,quantifier:'none'}
  ];
  for(const rule of cases){
    assert.equal(validateVerifierReferences([rule],outputs,{}),false,JSON.stringify(rule));
    assert.throws(()=>validateWorkflowContract(definition([rule])),{message:'INVALID_WORKFLOW_CONTRACT'});
  }
});

test('legacy rules still compare raw text and preserve unit-bearing string observations',()=>{
  const number={version:'legacy',steps:[],inputs:{quantity:{type:'number'}},outputs:[{name:'result',type:'number'}],verifiers:[{output:'result',input:'quantity'}]};
  assert.ok(verifyResult(number,{result:'2'},{quantity:2},'origin'));
  fails(()=>verifyResult(number,{result:'2.0'},{quantity:2},'origin'),'input_mismatch');
  const legacy={version:'legacy',steps:[],inputs:{},outputs:[{name:'result'}],verifiers:[{kind:'number',output:'result',unit:'°C'}]};
  assert.deepEqual(verifyResult(legacy,{result:'28 °C'},{},'origin').checks,['origin','nonempty_outputs','result_number']);
  fails(()=>verifyResult(legacy,{result:'28 °F'},{},'origin'),'unit_mismatch');
});
