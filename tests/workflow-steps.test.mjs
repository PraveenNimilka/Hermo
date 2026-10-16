import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkflowSteps} from '../server/workflow-steps.mjs';
import {PATH_INPUT_PATTERN} from '../server/workflow-contract.mjs';

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
