import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkflowSteps} from '../server/workflow-steps.mjs';
import {PATH_INPUT_PATTERN} from '../server/workflow-contract.mjs';
import {compileApprovalPolicy} from '../server/approval-policy.mjs';
import {executionCapabilities,normalizeExecutionConfig,validateExecutionConfig,workflowExecutionCompatibility} from '../server/execution-capabilities.mjs';

const options={origins:['https://shop.example'],sandboxOrigin:'http://127.0.0.1:4318',inputs:{query:{type:'string'},quantity:{type:'number'},enabled:{type:'boolean'},item_id:{type:'string',pattern:PATH_INPUT_PATTERN}}};
const validate=(steps,extra={})=>validateWorkflowSteps(steps,{...options,...extra});
const rejects=(steps,extra)=>assert.throws(()=>validate(steps,extra),{message:'INVALID_WORKFLOW_STEPS'});

test('legacy supported recordings retain ordered operations and values without mutating the source',()=>{
  const steps=[{op:'navigate',url:'https://shop.example/search'},{op:'fill',selector:'#query',frame_path:[],parameter:'query'},{op:'select',selector:'select[name="quantity"]',parameter:'quantity'},{op:'check',selector:'#enabled',parameter:'enabled'},{op:'click',selector:'form > button:nth-of-type(1)',frame_path:['iframe[name="shop"]']}];
  const before=structuredClone(steps),result=validate(steps);
  assert.deepEqual(result,before);assert.deepEqual(steps,before);assert.notEqual(result,steps);
  result[1].frame_path.push('#frame');assert.deepEqual(steps,before);
});

test('empty and disabled-only timelines remain valid for extraction-only workflows',()=>{
  assert.deepEqual(validate([]),[]);
  assert.deepEqual(validate([{op:'click',selector:'#optional',enabled:false}]),[{op:'click',selector:'#optional',enabled:false}]);
  rejects([{op:'evaluate',enabled:false,script:'document.cookie'}]);
  rejects([{op:'navigate',enabled:false,url:'https://evil.example'}]);
});

test('approval checkpoints are explicit booleans on action and navigation steps only',()=>{
  for(const step of [{op:'navigate',url:'https://shop.example/search'},{op:'click',selector:'#search'},{op:'fill',selector:'#query',parameter:'query'},{op:'select',selector:'#plan',value:'basic'},{op:'check',selector:'#consent',value:'true'}]){
    assert.equal(validate([{...step,approval_required:true}])[0].approval_required,true);
    assert.equal(validate([{...step,approval_required:false}])[0].approval_required,false);
    rejects([{...step,approval_required:'true'}]);
  }
  assert.equal(validate([{op:'click',selector:'#optional',enabled:false,approval_required:true}])[0].enabled,false);
  for(const step of [{op:'wait_element',selector:'#result',state:'visible'},{op:'wait_text',selector:'#result',text:'Ready'},{op:'wait_url',url:'https://shop.example/results'}]){
    rejects([{...step,approval_required:true}]);
    rejects([{...step,enabled:false,approval_required:true}]);
    assert.equal(validate([{...step,approval_required:false}])[0].approval_required,false);
  }
});

test('semantic locator candidates prioritize stable identities and reject ambiguous or unrestricted configuration',()=>{
  const result=validate([{op:'click',locators:[{kind:'css',value:'button.primary'},{kind:'label',value:'Search'},{kind:'role',role:'button',name:'Search'},{kind:'testId',value:'search-submit'}]}]);
  assert.deepEqual(result[0].locators.map(item=>item.kind),['testId','role','label','css']);
  for(const locator of [{kind:'role',role:'button'},{kind:'role',role:'made-up',name:'Search'},{kind:'label',value:''},{kind:'xpath',value:'//*'},{kind:'css',value:'button',javascript:'alert(1)'},{kind:'testId',value:'x',exact:false}])rejects([{op:'click',locators:[locator]}]);
  rejects([{op:'click',locators:[{kind:'testId',value:'search'},{kind:'testId',value:'search'}]}]);
  rejects([{op:'click',locators:Array.from({length:7},(_,i)=>({kind:'testId',value:String(i)}))}]);
  rejects([{op:'click'}]);
});

test('wait steps express bounded page state and exact URL matching defaults',()=>{
  for(const state of ['visible','hidden','enabled'])assert.equal(validate([{op:'wait_element',selector:'#results',state,timeout_ms:30000}])[0].state,state);
  assert.deepEqual(validate([{op:'wait_url',url:'https://shop.example/results'}]),[{op:'wait_url',url:'https://shop.example/results',match:'exact'}]);
  assert.equal(validate([{op:'wait_url',url:'https://shop.example/results?query=book',match:'contains'}])[0].match,'contains');
  assert.equal(validate([{op:'wait_text',locators:[{kind:'role',role:'status',name:'Search status'}],text:'Search complete',timeout_ms:250}])[0].text,'Search complete');
  for(const timeout_ms of [0,99,30001,Infinity,1.5,'1000'])rejects([{op:'wait_element',selector:'#result',state:'visible',timeout_ms}]);
  for(const step of [{op:'wait_element',selector:'#result',state:'attached'},{op:'wait_text',selector:'#result',text:'   '},{op:'wait_text',selector:'#result',text:'x'.repeat(2001)},{op:'wait',duration:1000},{op:'wait_url',url:'/results'}])rejects([step]);
});

test('navigation and URL waits respect exact approved origins and block credential/private route tricks',()=>{
  for(const url of ['https://evil.example/','https://shop.example.evil.test/','https://shop.example@evil.example/','https://name:password@shop.example/','javascript:alert(1)','data:text/html,hello','file:///private','http://shop.example/','https://127.0.0.1/','https://localhost/','https://service.internal/','https://shop.example:444/','https://shop.example/#fragment'])for(const op of ['navigate','wait_url'])rejects([{op,url}]);
  assert.equal(validate([{op:'navigate',url:options.sandboxOrigin+'/sandbox/catalog'}],{origins:[options.sandboxOrigin]})[0].url,options.sandboxOrigin+'/sandbox/catalog');
  for(const path of ['/studio/overview','/sandbox','/sandbox/../studio/keys'])rejects([{op:'navigate',url:options.sandboxOrigin+path}],{origins:[options.sandboxOrigin]});
  rejects([{op:'wait_url',url:'https://shop.example/results',match:'regex',pattern:'.*'}]);
});

test('dynamic navigation substitutes only a declared safe path parameter',()=>{
  const step={op:'navigate',template:'https://shop.example/items/{item_id}/',path_parameter:'item_id'};
  assert.deepEqual(validate([step]),[step]);
  assert.deepEqual(validate([{...step,url:'https://shop.example/items/book/'}]),[{...step,url:'https://shop.example/items/book/'}]);
  for(const template of ['https://{item_id}/','https://evil.example/items/{item_id}/','https://shop.example/items/{item_id}/?token=x','https://shop.example/items/{item_id}/#fragment','https://shop.example/items/prefix{item_id}/'])rejects([{...step,template}]);
  for(const input of [{type:'number'},{type:'string'},{type:'string',pattern:PATH_INPUT_PATTERN,required:false}])rejects([step],{inputs:{item_id:input}});
  rejects([{...step,path_parameter:'missing'}]);rejects([{op:'navigate',template:step.template}]);
});

test('typed input bindings require declared parameters and unambiguous static versus dynamic values',()=>{
  for(const parameter of ['query','quantity','enabled'])assert.equal(validate([{op:'fill',selector:'#field',parameter}])[0].parameter,parameter);
  rejects([{op:'fill',selector:'#field',parameter:'unknown'}]);
  rejects([{op:'fill',selector:'#field',parameter:'query',value:'stale-recording'}]);
  rejects([{op:'fill',selector:'#field'}]);
  assert.equal(validate([{op:'fill',selector:'#field',value:''}])[0].value,'');
  rejects([{op:'check',selector:'#check',parameter:'quantity'}]);
  rejects([{op:'check',selector:'#check',value:'yes'}]);
  assert.equal(validate([{op:'check',selector:'#check',value:'false'}])[0].value,'false');
  for(const op of ['check','select'])rejects([{op,selector:'#field',parameter:'query'}],{inputs:{query:{required:false}}});
  assert.equal(validate([{op:'select',selector:'#field',parameter:'query'}],{inputs:{query:{required:false,default:'fallback'}}})[0].parameter,'query');
  rejects([{op:'click',selector:'#button',parameter:'query'}]);
});

test('selectors remain bounded DOM CSS rather than arbitrary automation engines or code',()=>{
  for(const selector of ['xpath=//button','text=Search','button >> text=Delete',':has-text("Delete")',':text("Delete")',':nth-match(button, 2)','javascript:alert(1)','()=>document.cookie','eval(document.cookie)','button\u0000','x'.repeat(3001),''])rejects([{op:'click',selector}]);
  for(const selector of ['#search','[data-testid="search"]','main button[aria-label="Submit"]','form:has(input[name="query"]) > button','button:nth-child(2)'])assert.equal(validate([{op:'click',selector}])[0].selector,selector);
  rejects([{op:'click',selector:'#valid',frame_path:Array(9).fill('iframe')}]);
  rejects([{op:'click',selector:'#valid',frame_path:['xpath=//iframe']}]);
});

test('timeline bounds and strict step objects reject unrelated browser capabilities',()=>{
  assert.equal(validate(Array.from({length:32},()=>({op:'click',selector:'#button'}))).length,32);
  rejects(Array.from({length:33},()=>({op:'click',selector:'#button'})));
  for(const step of [{op:'click',selector:'#button',cookies:true},{op:'navigate',url:'https://shop.example',script:'alert(1)'},{op:'click',selector:'#button',enabled:'false'},{op:'press',key:'Enter'},{op:'fetch',url:'https://shop.example'},null])rejects([step]);
});

test('extended waits remain declarative, bounded and explicit about output predicates',()=>{
  assert.deepEqual(validate([{op:'wait_delay',duration_ms:100}]),[{op:'wait_delay',duration_ms:100}]);
  assert.deepEqual(validate([{op:'wait_navigation'}]),[{op:'wait_navigation',state:'load'}]);
  assert.deepEqual(validate([{op:'wait_navigation',url:'https://shop.example/results',state:'domcontentloaded'}]),[{op:'wait_navigation',url:'https://shop.example/results',state:'domcontentloaded'}]);
  assert.deepEqual(validate([{op:'wait_response',url:'https://shop.example/result'}]),[{op:'wait_response',url:'https://shop.example/result',method:'GET'}]);
  assert.equal(validate([{op:'wait_response',url:'https://shop.example/result',method:'HEAD',status:204}])[0].status,204);
  for(const value of [null,'',42,false])assert.deepEqual(validate([{op:'wait_output',output:'answer',predicate:'equals',value}],{outputs:[{name:'answer'}]}),[{op:'wait_output',output:'answer',predicate:'equals',value}]);
  assert.deepEqual(validate([{op:'wait_output',output:'answer',predicate:'nonempty'}],{outputs:[{name:'answer'}]}),[{op:'wait_output',output:'answer',predicate:'nonempty'}]);
  rejects([{op:'wait_output',output:'answer',predicate:'equals'}]);rejects([{op:'wait_output',output:'answer',predicate:'nonempty',value:'ignored'}]);
  rejects([{op:'wait_output',output:'missing',predicate:'nonempty'}],{outputs:[{name:'answer'}]});rejects([{op:'wait_output',output:'answer',predicate:'equals',value:{nested:true}}]);rejects([{op:'wait_output',output:'answer',predicate:'equals',value:Infinity}]);
  for(const duration_ms of [0,99,10001,1.5,'1000'])rejects([{op:'wait_delay',duration_ms}]);
  for(const step of [{op:'wait_delay',duration_ms:1000,selector:'#unused'},{op:'wait_navigation',state:'networkidle'},{op:'wait_navigation',script:'document.cookie'},{op:'wait_response',url:'https://shop.example/result',method:'POST'},{op:'wait_response',url:'https://shop.example/result',status:600}])rejects([step]);
});

test('extended waits validate exact approved URLs and common deadline limits',()=>{
  const waits=[{op:'wait_delay',duration_ms:1000},{op:'wait_navigation'},{op:'wait_output',output:'answer',predicate:'nonempty'},{op:'wait_response',url:'https://shop.example/result'}];
  for(const step of waits){
    assert.equal(validate([{...step,timeout_ms:100,error_policy:'stop'}])[0].timeout_ms,100);
    assert.equal(validate([{...step,timeout_ms:30000,error_policy:'continue'}])[0].error_policy,'continue');
    for(const timeout_ms of [0,99,30001,Infinity,'1000'])rejects([{...step,timeout_ms}]);
    rejects([{...step,approval_required:true}]);
  }
  for(const op of ['wait_navigation','wait_response'])for(const url of ['https://evil.example/result','https://shop.example.evil.test/result','file:///private','https://user:secret@shop.example/result','https://127.0.0.1/result',options.sandboxOrigin+'/studio/session'])rejects([{op,url}]);
  for(const step of [{op:'navigate',url:'https://shop.example/'},{op:'click',selector:'#search'},{op:'fill',selector:'#query',parameter:'query'},{op:'check',selector:'#agree',value:'true'}])rejects([{...step,error_policy:'continue'}]);
  rejects([{op:'wait_delay',duration_ms:1000,error_policy:'retry'}]);
  const compiled=compileApprovalPolicy({steps:waits,approval_policy:{mode:'risk_rules',rules:[{operations:['wait_output','wait_delay','wait_response','wait_navigation']}]}});
  assert.equal(compiled.steps.every(step=>step.approval_required===true),true,'Configured policies can pause before waits even though authored explicit wait gates are rejected');
});

test('execution capability metadata advertises response observation only for the managed adapter',()=>{
  const source={id:'conn_extended_waits',url:'https://shop.example/',origins:['https://shop.example'],access:'public',browser_mode:'isolated'},connected={...source,browser_mode:'connected'};
  const responseStep={op:'wait_response',url:'https://shop.example/result',method:'GET',status:200};
  const definition={steps:[responseStep],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[],effect:'retrieval'};
  assert.equal(executionCapabilities('managed_local').operations.includes('wait_response'),true);assert.equal(executionCapabilities('connected_chrome').operations.includes('wait_response'),false);
  assert.equal(executionCapabilities('managed_local').network_response_wait,true);assert.equal(executionCapabilities('connected_chrome').network_response_wait,false);
  assert.equal(normalizeExecutionConfig(connected).allowed_actions.includes('wait_response'),false);
  assert.throws(()=>validateExecutionConfig(connected,{...normalizeExecutionConfig(connected),allowed_actions:['wait_response']}),/INVALID_EXECUTION_CONFIG/);
  assert.equal(workflowExecutionCompatibility(source,definition).compatible,true);
  const unsupported=workflowExecutionCompatibility(connected,definition);assert.equal(unsupported.compatible,false);assert.match(unsupported.errors.find(error=>error.code==='UNSUPPORTED_STEP').message,/cannot observe network responses/);
  for(const step of [{op:'wait_delay',duration_ms:1000},{op:'wait_navigation',state:'load'},{op:'wait_output',output:'answer',predicate:'nonempty'}])assert.equal(workflowExecutionCompatibility(connected,{...definition,steps:[step]}).compatible,true);
  assert.equal(workflowExecutionCompatibility(source,{...definition,steps:[{op:'wait_output',output:'missing',predicate:'nonempty'}]}).errors[0].code,'INVALID_OUTPUT_REFERENCE');
  assert.equal(workflowExecutionCompatibility(source,{...definition,steps:[{...responseStep,url:'https://evil.example/result'}]}).errors[0].code,'NAVIGATION_NOT_ALLOWED');
});
