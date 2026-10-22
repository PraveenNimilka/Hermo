import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalPolicySchema,stepRiskSchema,resolveApprovalPolicy,effectiveApprovalSteps,compileApprovalPolicy,requiresInvocationApproval} from '../server/approval-policy.mjs';

const definition=(approval_policy,steps=[{op:'navigate'},{op:'fill'},{op:'click'}])=>({steps,...approval_policy===undefined?{}:{approval_policy}});

test('legacy definitions and none policy preserve every explicit gate',()=>{
  for(const policy of [undefined,{mode:'none'}]){
    const value=definition(policy,[{op:'click',approval_required:true},{op:'fill',approval_required:false},{op:'click',enabled:false,approval_required:true}]);
    assert.deepEqual(effectiveApprovalSteps(value),[1]);
    assert.deepEqual(resolveApprovalPolicy(value).classifications.map(step=>step.reason),['explicit_step','not_required','disabled']);
  }
});

test('selected step gates use immutable one-based order and do not enable disabled steps',()=>{
  const value=definition({mode:'selected_steps',steps:[2,3]},[{op:'navigate',approval_required:true},{op:'click',enabled:false},{op:'fill'}]);
  assert.deepEqual(effectiveApprovalSteps(value),[1,3]);
  assert.throws(()=>effectiveApprovalSteps(definition({mode:'selected_steps',steps:[4]})),/INVALID_APPROVAL_POLICY/);
});

test('every invocation gates its first enabled step and retains later explicit gates',()=>{
  const value=definition({mode:'every_invocation'},[{op:'navigate',enabled:false},{op:'wait_element'},{op:'click',approval_required:true}]);
  assert.deepEqual(effectiveApprovalSteps(value),[2,3]);
  assert.equal(requiresInvocationApproval(value),false);
  for(const steps of [[],[{op:'navigate',enabled:false}]]){
    const invocation=definition({mode:'every_invocation'},steps);assert.deepEqual(effectiveApprovalSteps(invocation),[]);assert.equal(requiresInvocationApproval(invocation),true);assert.equal(compileApprovalPolicy(invocation).steps.length,steps.length,'invocation policy never fabricates browser steps');
  }
  assert.equal(requiresInvocationApproval(definition(undefined,[])),false);
});

test('risk rules match only configured operations and explicit classifications',()=>{
  const value=definition({mode:'risk_rules',rules:[{operations:['fill'],risks:['high','critical']},{risks:['critical']}]},[
    {op:'click',risk:'low',value:'delete everything'},
    {op:'fill',risk:'high'},
    {op:'select',risk:'critical'},
    {op:'fill',risk:'medium'},
    {op:'click',name:'purchase',value:'secret'}
  ]);
  assert.deepEqual(effectiveApprovalSteps(value),[2,3]);
  assert.deepEqual(effectiveApprovalSteps(definition({mode:'risk_rules',rules:[{operations:['click']}]},value.steps)),[1,5]);
  assert.deepEqual(effectiveApprovalSteps(definition({mode:'risk_rules',rules:[{risks:['unspecified']}]},value.steps)),[5]);
});

test('policy diagnostics omit values, locator names and arbitrary authoring properties',()=>{
  const value=definition({mode:'risk_rules',rules:[{risks:['high']}]},[{op:'fill',risk:'high',parameter:'password',value:'private-value',locators:[{kind:'role',name:'private-name'}]}]);
  const summary=resolveApprovalPolicy(value);
  assert.deepEqual(summary.required_steps,[1]);
  assert.equal(JSON.stringify(summary).includes('private'),false);
  assert.equal(JSON.stringify(summary).includes('password'),false);
});

test('effective definitions are private copies and preserve authoring policy and data',()=>{
  const value=definition({mode:'every_invocation'},[{op:'fill',value:'private-value',locators:[{kind:'label',value:'Account'}]},{op:'click'}]);
  const before=JSON.stringify(value),compiled=compileApprovalPolicy(value);
  assert.deepEqual(compiled.approval_policy,value.approval_policy);
  assert.equal(compiled.steps[0].approval_required,true);
  assert.equal(compiled.steps[1].approval_required,false);
  assert.equal(compiled.steps[0].value,'private-value');
  compiled.steps[0].locators[0].value='Changed execution copy';
  assert.equal(JSON.stringify(value),before);
});

test('malformed or unsupported policies fail closed without reflecting sensitive payloads',()=>{
  const policies=[null,[],true,{mode:'unknown'},{mode:'none',rules:[]},{mode:'selected_steps',steps:[]},{mode:'selected_steps',steps:[0]},
    {mode:'selected_steps',steps:[1,1]},{mode:'selected_steps',steps:[1.5]},{mode:'selected_steps',steps:[33]},
    {mode:'risk_rules',rules:[]},{mode:'risk_rules',rules:[{}]},{mode:'risk_rules',rules:[{operations:[]}]},
    {mode:'risk_rules',rules:[{operations:['execute_script']}]},{mode:'risk_rules',rules:[{risks:['high','high']}]},
    {mode:'risk_rules',rules:[{input:'private-value'}]}];
  for(const policy of policies)assert.throws(()=>effectiveApprovalSteps(definition(policy)),error=>error.message==='INVALID_APPROVAL_POLICY');
  for(const steps of [[{op:'click',risk:'guessed'}],[{op:'click',approval_required:'yes'}],[{op:'click',enabled:'yes'}],[{op:'execute_script'}],Array.from({length:33},()=>({op:'click'}))]){
    assert.throws(()=>effectiveApprovalSteps(definition(undefined,steps)),error=>error.message==='INVALID_APPROVAL_POLICY');
  }
  assert.equal(approvalPolicySchema.safeParse({mode:'none'}).success,true);
  assert.equal(stepRiskSchema.safeParse('high').success,true);
  assert.throws(()=>effectiveApprovalSteps(null),/INVALID_APPROVAL_POLICY/);
});
