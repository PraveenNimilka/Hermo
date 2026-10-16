import test from 'node:test';
import assert from 'node:assert/strict';
import {executionCapabilities,normalizeExecutionConfig,validateExecutionConfig,workflowExecutionCompatibility} from '../server/execution-capabilities.mjs';

const options={sandboxOrigin:'http://127.0.0.1:4488'};
const connection={id:'conn_fixture',url:'https://shop.example/catalog/',origins:['https://shop.example','https://assets.example'],access:'public',browser_mode:'isolated'};
const definition={steps:[{op:'navigate',url:connection.url}],inputs:{},outputs:[{name:'title',selector:'h1',type:'string'}],verifiers:[{kind:'nonempty',output:'title'}],effect:'retrieval'};
const report=(patch={},source=connection,config)=>workflowExecutionCompatibility(source,{...definition,...patch},config,options);

test('execution configuration is explicit, canonical, connection-bound and contains no credentials',()=>{
  const config=normalizeExecutionConfig({...connection,storageState:{cookies:[{value:'private'}]}},options);
  assert.equal(config.mode,'managed_local');assert.equal(config.network_policy,'retrieval');
  assert.deepEqual(config.session_binding,{kind:'anonymous',connection_id:connection.id});
  assert.deepEqual(config.allowed_origins,['https://assets.example','https://shop.example']);
  assert.equal(JSON.stringify(config).includes('private'),false);assert.equal(report().compatible,true);
  assert.equal(executionCapabilities(config.mode).requires_available_tab,false);
  assert.equal(executionCapabilities('connected_chrome').frames,false);
  assert.throws(()=>executionCapabilities('cloud'),/INVALID_EXECUTION_CONFIG/);
});

test('no implicit Chrome-to-managed switch or shared Google session import',()=>{
  const chrome={...connection,browser_mode:'connected',access:'account'};
  assert.throws(()=>normalizeExecutionConfig(chrome,{...options,mode:'managed_local'}),/EXECUTION_MODE_MISMATCH/);
  assert.throws(()=>normalizeExecutionConfig({...connection,browser_profile_id:'profile_shared'},options),/SHARED_SESSION_NOT_SUPPORTED/);
  assert.equal(report({}, {...connection,browser_profile_id:'profile_shared'}).errors[0].code,'SHARED_SESSION_NOT_SUPPORTED');
  assert.deepEqual(normalizeExecutionConfig(chrome,options).session_binding,{kind:'selected_tab',connection_id:chrome.id});
  assert.equal(normalizeExecutionConfig({...connection,access:'account'},options).session_binding.kind,'dedicated_connection');
});

test('configuration validation rejects arbitrary authority and private destinations',()=>{
  for(const patch of [{origins:['https://shop.example/*']},{origins:['https://127.0.0.1']},{origins:['https://shop.example',options.sandboxOrigin]},{url:'https://other.example/'},{browser_mode:'cloud'}])assert.throws(()=>normalizeExecutionConfig({...connection,...patch},options),/INVALID_EXECUTION_CONFIG/);
  const config=normalizeExecutionConfig(connection,options);
  for(const patch of [{connection_id:'other'},{network_policy:'selected_tab'},{allowed_origins:[...config.allowed_origins,'https://evil.example']},{session_binding:{kind:'anonymous',connection_id:'other'}},{javascript:'return cookies'}])assert.equal(report({},connection,{...config,...patch}).compatible,false);
  const restricted={...config,allowed_actions:['navigate']};assert.equal(report({},connection,restricted).compatible,true);
  assert.deepEqual(validateExecutionConfig(connection,restricted,options).allowed_actions,['navigate']);
  assert.equal(report({steps:[{op:'click',selector:'button'}]},connection,restricted).errors[0].code,'UNSUPPORTED_STEP');
});

test('managed retrieval capabilities report actual restrictions, never managed mutation support',()=>{
  for(const op of ['navigate','click','fill','select','check']){
    const steps=[op==='navigate'?{op,url:connection.url}:{op,selector:'#control'}];
    assert.equal(report({steps}).compatible,true,op);
  }
  for(const patch of [{action_type:'generate_media'},{action_type:'submit_form'},{effect:'recorded_browser_actions'},{execution:{network_policy:'authorized_actions'}}])assert.ok(report(patch).errors.some(error=>error.code==='MANAGED_ACTIONS_NOT_SUPPORTED'));
  for(const op of ['evaluate','wait','extract_collection','upload','scroll'])assert.equal(report({steps:[{op}]}).errors[0].code,'UNSUPPORTED_STEP');
  assert.ok(report({steps:[{op:'click',selector:'button'}]}).warnings.some(value=>value.code==='RETRIEVAL_NETWORK_ONLY'));
  assert.ok(report({}, {...connection,access:'account'}).warnings.some(value=>value.code==='AUTHENTICATION_SETUP_REQUIRED'));
});

test('navigation respects exact scope, sandbox path and supported parameter templates',()=>{
  for(const url of ['https://evil.example/','https://shop.example.attacker.test/','file:///private','javascript:alert(1)','https://shop.example/?x=1#fragment'])assert.ok(report({steps:[{op:'navigate',url}]}).errors.some(value=>value.code==='NAVIGATION_NOT_ALLOWED'));
  assert.equal(report({steps:[{op:'navigate',path_parameter:'product_id',template:'https://shop.example/item/{product_id}/'}]}).compatible,true);
  assert.equal(report({steps:[{op:'navigate',path_parameter:'product_id',template:'https://{product_id}/'}]}).errors[0].code,'INVALID_PAGE_TEMPLATE');
  const local={...connection,url:options.sandboxOrigin+'/sandbox/weather',origins:[options.sandboxOrigin]};
  assert.equal(report({steps:[{op:'navigate',url:local.url}]},local).compatible,true);
  assert.ok(report({steps:[{op:'navigate',url:options.sandboxOrigin+'/studio/overview'}]},local).errors.some(value=>value.code==='NAVIGATION_NOT_ALLOWED'));
  const chrome={...connection,browser_mode:'connected'};
  assert.ok(report({steps:[{op:'navigate',url:'https://assets.example/'}]},chrome).errors.some(value=>value.code==='NAVIGATION_NOT_ALLOWED'));
});

test('frame and scalar extraction support matches current adapters',()=>{
  const framed={steps:[{op:'fill',selector:'input',frame_path:['iframe']}],outputs:[{name:'result',selector:'output',frame_path:['iframe'],type:'number'}]};
  assert.equal(report(framed).compatible,true);
  assert.equal(report(framed,{...connection,browser_mode:'connected'}).errors.filter(value=>value.code==='UNSUPPORTED_FRAME').length,2);
  assert.ok(report({steps:[{op:'click',selector:'button',frame_path:'iframe'}]}).errors.some(value=>value.code==='INVALID_LOCATOR'));
  assert.ok(report({outputs:[{name:'result',selector:'output',type:'array'}]}).errors.some(value=>value.code==='UNSUPPORTED_OUTPUT'));
  assert.ok(report({outputs:[{name:'result',selector:'img',read_attribute:'cookie'}]}).errors.some(value=>value.code==='UNSUPPORTED_OUTPUT'));
  assert.equal(report({outputs:[{name:'result',selector:'img',read_attribute:'src',type:'url'}]}).compatible,true);
  assert.equal(report({outputs:[{name:'result',selector:'img',read_attribute:'alt'}]}).compatible,true);
  assert.ok(report({outputs:[{name:'result',selector:'[data-turn="assistant"]',read_mode:'last'}]}).errors.some(value=>value.code==='UNSUPPORTED_OUTPUT'));
  assert.ok(report({outputs:[{name:'result',selector:':hermo-heading-assistant'}]}).errors.some(value=>value.code==='UNSUPPORTED_OUTPUT'));
  assert.equal(report({required_capabilities:['frames','step.navigate','extract.text']}).compatible,true);
  assert.equal(report({required_capabilities:['javascript.evaluate']}).errors[0].code,'CAPABILITY_NOT_SUPPORTED');
  assert.equal(report({required_capabilities:'frames'}).errors[0].code,'INVALID_CAPABILITIES');
  for(const outputs of [[null],[false],[{name:'result',selector:17}],[]])assert.equal(report({outputs}).compatible,false);
});
