import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import http from 'node:http';
import Fastify from 'fastify';
import {installMcp} from '../server/mcp.mjs';
import {executionCapabilities,workflowExecutionCompatibility} from '../server/execution-capabilities.mjs';
import {EventEmitter} from 'node:events';
import {validateOutputMappings,outputMappingSchema,validateWorkflowContract,outputJsonSchema,convertOutputs} from '../server/workflow-contract.mjs';
import {verifyResult,validateVerifiers} from '../server/verification.mjs';
import {extractOutputDocument} from '../companion/browser/output-extraction.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';
import {installConnectedBrowser} from '../server/connected-browser.mjs';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';
import {hash} from '../server/store.mjs';

const rows={name:'products',type:'array',selector:'.product',maxItems:3,items:{type:'object',fields:[{name:'title',selector:'.title'},{name:'price',type:'number',selector:'.price'},{name:'available',type:'boolean',selector:'.available'},{name:'website',type:'url',selector:'a',read_attribute:'href'},{name:'discount',selector:'.discount',required:false},{name:'rating',type:'number',selector:'.rating',nullable:true}]}};
const markup='<h1>Public catalog</h1><div id="catalog">'+[1,2].map(()=>'<article class="product"><h2 class="title">Same title</h2><span class="price">149.99</span><span class="available">false</span><a href="/item">View product</a></article>').join('')+'</div>';
const expected=origin=>({products:[1,2].map(()=>({title:'Same title',price:149.99,available:false,website:origin+'/item',rating:null}))});
const definition=outputs=>({version:'structured-test',inputs:{},outputs,steps:[],verifiers:[],effect:'retrieval'});
const rejects=(run,reason)=>assert.throws(run,error=>error.message==='VERIFICATION_FAILED'&&error.verification.reason===reason);

test('recursive mappings retain legacy locators while bounding shape, selectors and nested permissions',()=>{
  const parsed=validateOutputMappings([rows,{name:'account',selector:':hermo-latest-user',read_mode:'last',frame_path:['#frame']},{name:'query',source:'url_parameter',template:'https://example.com/items/{{query}}',parameter:'query'}]);
  assert.equal(parsed[0].items.fields[0].type,'string');assert.equal(parsed[1].read_mode,'last');assert.equal(parsed[1].frame_path[0],'#frame');
  assert.equal(outputMappingSchema.safeParse(rows).success,true);
  for(const mutation of [r=>r.maxItems=101,r=>r.minItems=4,r=>r.items.fields.push({name:'title',selector:'p'}),r=>r.items.fields[0].frame_path=['iframe'],r=>r.items.fields[0].source='url_parameter',r=>r.selector='javascript:alert(1)',r=>r.selector='div >> text=secret',r=>r.items={type:'array',selector:'.x',items:{type:'object',fields:[{name:'nested',type:'array',selector:'.y',items:{type:'object',fields:[{name:'deep',selector:'p'}]}}]}}]){
    const value=structuredClone(rows);mutation(value);assert.throws(()=>validateOutputMappings([value]),{message:'INVALID_OUTPUT_MAPPINGS'});
  }
  assert.throws(()=>validateOutputMappings([{name:'value',selector:'#value',type:'object'}]),{message:'INVALID_OUTPUT_MAPPINGS'});
  const original=definition([rows]);assert.deepEqual(validateWorkflowContract(original).outputs[0],parsed[0]);
});

test('conversion returns only declared typed structures, never guesses formatted numbers or missing fields',()=>{
  const mappings=validateOutputMappings([rows]),raw={products:[{title:'Product',price:'149.99',available:'false',website:'https://example.com/item',private:'excluded'}]};
  assert.deepEqual(convertOutputs(mappings,raw),{products:[{title:'Product',price:149.99,available:false,website:'https://example.com/item',rating:null}]});
  const bad=structuredClone(raw);bad.products[0].price='$149.99 secret';rejects(()=>convertOutputs(mappings,bad),'invalid_number');
  bad.products[0].price='149.99';bad.products[0].available='yes';rejects(()=>convertOutputs(mappings,bad),'invalid_boolean');
  delete bad.products[0].title;rejects(()=>convertOutputs(mappings,bad),'missing_output');
  rejects(()=>convertOutputs(mappings,{products:{}}),'invalid_structure');
  rejects(()=>convertOutputs(mappings,{products:[] }),'collection_limit');
  rejects(()=>convertOutputs(mappings,{products:[...raw.products,...raw.products,...raw.products,...raw.products]}),'collection_limit');
  assert.deepEqual(convertOutputs([{...rows,minItems:0}],{products:[]}),{products:[]});
  assert.deepEqual(convertOutputs([{name:'maybe',selector:'.x',required:false},{name:'value',selector:'.y',nullable:true}],{}),{value:null});
  rejects(()=>convertOutputs([{name:'maybe',selector:'.x',type:'number',required:false}],{maybe:'not a number'}),'invalid_number');
});

test('recursive JSON schemas match optional, nullable and collection validation and reject scalar verifier misuse',()=>{
  const outputs=validateOutputMappings([rows,{name:'metadata',type:'object',fields:[{name:'label',selector:'#label',nullable:true},{name:'maybe',selector:'#absent',required:false}],nullable:true}]);
  const schema=outputJsonSchema(outputs),item=schema.properties.products.items;
  assert.equal(schema.properties.products.maxItems,3);assert.equal(schema.properties.products.minItems,1);assert.deepEqual(item.required,['title','price','available','website','rating']);
  assert.equal(item.properties.price.type,'number');assert.equal(item.properties.website.format,'uri');assert.equal(item.properties.rating.anyOf[1].type,'null');assert.equal(schema.properties.metadata.anyOf[0].type,'object');
  assert.equal(validateVerifiers([{kind:'contains',output:'products',value:'x'}],outputs,{}),false);
  assert.throws(()=>validateWorkflowContract({...definition(outputs),verifiers:[{kind:'number',output:'products'}]}),{message:'INVALID_WORKFLOW_CONTRACT'});
  const d={...definition([{...rows,minItems:0}]),verifiers:[{kind:'nonempty',output:'products'}]};rejects(()=>verifyResult(d,{products:[]},{},'origin'),'missing_output');
});

test('capability reporting and scoped MCP contracts describe the same recursive output schema',async t=>{
  const outputs=validateOutputMappings([rows]),w={id:'wf_owned',name:'Catalog',slug:'catalog',version:'hash-v2',revision:2,status:'published',definition:definition(outputs)};
  for(const mode of ['managed_local','connected_chrome']){const capabilities=executionCapabilities(mode);assert.equal(capabilities.collections,true);assert.ok(capabilities.output_types.includes('object'));}
  const connection={id:'conn_owned',url:'https://example.com/catalog',origins:['https://example.com'],access:'public'};
  assert.equal(workflowExecutionCompatibility(connection,w.definition,undefined,{}).compatible,true);
  const app=Fastify();t.after(()=>app.close());app.addHook('preHandler',async req=>{req.consumer={workflow_id:w.id,id:'key_owned'};});
  installMcp(app,{origin:'http://127.0.0.1:4318',aliases:['127.0.0.1:4318'],workflow:id=>{assert.equal(id,w.id);return w;},enqueue:()=>{},db:{},safeRun:()=>{},cancel:()=>{},fail:code=>{throw Error(code);},rate:()=>{}});
  const response=await app.inject({method:'POST',url:'/mcp',headers:{host:'127.0.0.1:4318',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_contract',arguments:{}}}});
  assert.equal(response.statusCode,200,response.body);const contract=response.json().result.structuredContent;
  assert.equal(contract.workflow_id,w.id);assert.equal(contract.revision,2);assert.deepEqual(contract.output_schema,outputJsonSchema(outputs));
  assert.equal(JSON.stringify(contract).includes('selector'),false);
});

async function documentFixture(t,html=markup){
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});t.after(()=>browser.close());
  const page=await browser.newPage();await page.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://example.com/task');
  const chrome={tabs:{get:async()=>({url:page.url(),status:'complete',windowId:1}),update:async(_,{url})=>{if(url)await page.goto(url);}},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
  return {page,chrome};
}

test('the shared real DOM extractor scopes repeating items, preserves duplicate rows and refuses ambiguity/secrets/overflow',async t=>{
  const {page,chrome}=await documentFixture(t);
  const run=mapping=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'extract',mapping},inspect:inspectDocument,deadline:Date.now()+5000});
  const observed=await run(rows),again=await run(rows);assert.equal(again.identity,observed.identity,'reading an unchanged DOM never manufactures freshness');await page.locator('.product').first().evaluate(element=>element.replaceWith(element.cloneNode(true)));const replaced=await run(rows);assert.notEqual(replaced.identity,observed.identity);assert.deepEqual(replaced.value,observed.value);assert.deepEqual(convertOutputs([rows],{products:observed.value}),expected('https://example.com'));
  await assert.rejects(run({...rows,maxItems:1}),{message:'OUTPUT_LIMIT_EXCEEDED'});
  await assert.rejects(run({name:'title',selector:'.title'}),{message:'ELEMENT_AMBIGUOUS'});
  await assert.rejects(run({...rows,selector:'javascript:alert(1)'}),{message:'ACTION_UNAVAILABLE'});
  assert.equal((await run({...rows,selector:'.absent',required:false})).value,undefined);
  assert.deepEqual(convertOutputs([{...rows,selector:'.absent',nullable:true}],{products:(await run({...rows,selector:'.absent',nullable:true})).value}),{products:null});
  const omitted=await run({name:'maybe',selector:'.absent',required:false});assert.equal(omitted.value,undefined);assert.equal(omitted.count,0);
  await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend','<input type="password" value="must-not-read">'));
  await assert.rejects(run(rows),{message:'LOGIN_REQUIRED'});
});

async function connectedAdapter(t,fixture,capabilities=['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs']){
  const handlers=new Map(),app={post:(path,...args)=>handlers.set('POST '+path,args.at(-1)),get:(path,...args)=>handlers.set('GET '+path,args.at(-1)),options:()=>{}};
  const owner='synthetic-structured-owner',extension='a'.repeat(32),sessions=new Map([[hash(owner),{authenticated:true,expires:Date.now()+60000}]]);
  let connection={id:'conn_structured',name:'Catalog',url:'https://example.com/task',origins:['https://example.com'],access:'public',status:'connected',browser_mode:'connected',identity:{kind:'selected_tab',origin:'https://example.com'}};
  const engine=installConnectedBrowser(app,{origin:'http://127.0.0.1:4318',store:{audit:()=>{}},session:()=>({authenticated:true}),sessions,ownerCookie:'owner',connection:()=>connection,saveConnection:(_,changes,status)=>{connection={...connection,...changes,status};},invalidate:()=>{},recordings:new Map(),fail:code=>{throw Error(code);},rate:()=>{},stopRuns:()=>{},browserWorkspaces:{},connectionBusy:()=>false,isRecording:()=>false,baseEngine:{close:async()=>{},closeAll:async()=>{}}});
  const invoke=(path,body,extra={})=>handlers.get('POST '+path)({method:'POST',body,params:{cid:connection.id},cookies:{owner},headers:{'x-hermo-extension-id':extension,...extra}},{raw:new EventEmitter()});
  const grant=await invoke('/studio/connections/:cid/browser-link',{authorized:true});
  const pair=await invoke('/companion/browser/pair',{code:grant.code,origin:'https://example.com',authorized:true,protocol:2,capabilities,context_id:'bc_'+'a'.repeat(36),tab_id:1});
  const authorization={authorization:'Bearer '+pair.token};let running=true;
  const pump=(async()=>{while(running){const message=await invoke('/companion/browser/poll',{},authorization);if(message.type==='closed')break;if(message.type!=='command')continue;let value,error;
    try{value=await executeBrowserCommand({chrome:fixture.chrome,tabId:1,origin:message.origin,pathPrefix:message.path_prefix,command:message.command,inspect:inspectDocument,deadline:message.expires_at,beforeMutation:()=>invoke('/companion/browser/authorize',{id:message.id},authorization)});}catch(problem){error=problem.message;}
    if(running)await invoke('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}},authorization);
  }})();
  t.after(async()=>{running=false;await engine.closeAll();await pump;});
  return {engine,connection:()=>connection};
}

test('connected adapter executes nested real DOM extraction and fails invalid/missing values without success',async t=>{
  const fixture=await documentFixture(t),{engine,connection}=await connectedAdapter(t,fixture),execute=outputs=>engine.execute(connection(),definition(validateOutputMappings(outputs)),{},()=>{},new AbortController().signal);
  assert.deepEqual((await execute([rows])).result,expected('https://example.com'));
  await fixture.page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend','<button id="refresh" onclick="document.querySelector(\'.product\').replaceWith(document.querySelector(\'.product\').cloneNode(true))">Refresh catalog</button>'));
  const fresh={...definition(validateOutputMappings([rows])),steps:[{op:'click',selector:'#refresh'}],verifiers:[{kind:'changed',output:'products'}]};assert.deepEqual((await engine.execute(connection(),fresh,{},()=>{},new AbortController().signal)).result,expected('https://example.com'));

  await fixture.page.locator('.price').first().evaluate(element=>element.textContent='$149.99 private');
  await assert.rejects(execute([rows]),error=>error.message==='VERIFICATION_FAILED'&&error.verification.reason==='invalid_number'&&!JSON.stringify(error).includes('private'));
  await fixture.page.locator('.price').first().evaluate(element=>element.remove());
  await assert.rejects(execute([rows]),error=>error.message==='VERIFICATION_FAILED'&&error.verification.reason==='missing_output');
  await assert.rejects(execute([{...rows,maxItems:1}]),{message:'OUTPUT_LIMIT_EXCEEDED'});
});

test('an unchanged prior result cannot satisfy an explicitly fresh changed verifier',{timeout:25000},async t=>{
  const fixture=await documentFixture(t,'<button id="submit">Submit without a result</button><output id="result">Old value</output>'),{engine,connection}=await connectedAdapter(t,fixture);
  const d={...definition([{name:'result',selector:'#result'}]),steps:[{op:'click',selector:'#submit'}],verifiers:[{kind:'changed',output:'result'}],timeout_ms:15000};
  await assert.rejects(engine.execute(connection(),d,{},()=>{},new AbortController().signal),error=>error.message==='VERIFICATION_FAILED'&&error.verification.reason==='not_fresh');
});

test('connected generated media follows a new response instead of its recording-time image ID',async t=>{
  const fixture=await documentFixture(t,'<main><button id="generate">Generate image</button><article data-message-author-role="assistant" id="old-turn"><img id="temporary-old" src="/old.svg" width="240" height="160"></article></main>');
  await fixture.page.route('**/*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"/>'}));
  await fixture.page.locator('#temporary-old').evaluate(el=>{el.src='/seed.svg';});await fixture.page.waitForFunction(()=>document.querySelector('img').naturalWidth>0);
  await fixture.page.locator('#generate').evaluate(button=>button.onclick=()=>{const article=document.createElement('article');article.dataset.messageAuthorRole='assistant';article.innerHTML='<img id="temporary-new" src="/fresh.svg" width="240" height="160">';document.querySelector('main').append(article);});
  const item=(await fixture.page.evaluate(inspectDocument,{connected:true})).elements.find(item=>item.type==='image_url');assert.equal(item.read_mode,'last');
  const {engine,connection}=await connectedAdapter(t,fixture),d={...definition([{name:'image_url',type:'url',selector:item.selector,read_mode:item.read_mode,read_attribute:'src'}]),action_type:'generate_media',steps:[{op:'click',selector:'#generate'}],verifiers:[{kind:'url',output:'image_url'},{kind:'changed',output:'image_url'}],timeout_ms:15000};
  const run=await engine.execute(connection(),d,{},()=>{},new AbortController().signal);assert.equal(run.result.image_url,'https://example.com/fresh.svg');assert.ok(run.verification.checks.includes('fresh_generated_outputs'));
});

test('legacy connected links retain scalar reads and explicitly require extension update for new operations',async t=>{
  const fixture=await documentFixture(t,'<output id="result">Existing scalar</output>'),{engine,connection}=await connectedAdapter(t,fixture,['panel','read_data','saved_browser','command_guard']);
  const run=outputs=>engine.execute(connection(),definition(outputs),{},()=>{},new AbortController().signal);
  assert.equal((await run([{name:'result',selector:'#result'}])).result.result,'Existing scalar');
  await assert.rejects(run([rows]),{message:'COMPANION_UPDATE_REQUIRED'});
  await assert.rejects(engine.execute(connection(),{...definition([{name:'result',selector:'#result'}]),steps:[{op:'wait_element',selector:'#result',state:'visible'}]},{},()=>{},new AbortController().signal),{message:'COMPANION_UPDATE_REQUIRED'});
});

test('managed adapter executes actual browser/network extraction with identical schemas and failure semantics',{timeout:60000},async t=>{
  let body=markup;
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(body);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,proxy=await createEgressProxy(origin),engine=await createBrowserEngine(proxy,origin);
  t.after(async()=>{await engine.closeAll();await proxy.close();await new Promise(resolve=>server.close(resolve));});
  const connection={id:'conn_managed_structured',url:origin+'/sandbox/catalog',origins:[origin],access:'public',identity:{kind:'public_origin',origin}},run=outputs=>engine.execute(connection,definition(validateOutputMappings(outputs)),{},()=>{},new AbortController().signal);
  assert.deepEqual((await run([rows])).result,expected(origin));
  body=markup+'<button id="refresh" onclick="document.querySelector(\'.product\').replaceWith(document.querySelector(\'.product\').cloneNode(true))">Refresh catalog</button>';
  const fresh={...definition(validateOutputMappings([rows])),steps:[{op:'click',selector:'#refresh'}],verifiers:[{kind:'changed',output:'products'}]};assert.deepEqual((await engine.execute(connection,fresh,{},()=>{},new AbortController().signal)).result,expected(origin));

  body=markup.replace('149.99','invalid confidential');await assert.rejects(run([rows]),error=>error.message==='VERIFICATION_FAILED'&&error.verification.reason==='invalid_number'&&!JSON.stringify(error).includes('confidential'));
  body=markup.replace('<span class="price">149.99</span>','');await assert.rejects(run([rows]),error=>error.message==='VERIFICATION_FAILED'&&error.verification.reason==='missing_output');
  body=markup;await assert.rejects(run([{...rows,maxItems:1}]),{message:'OUTPUT_LIMIT_EXCEEDED'});
  body='<h1>Empty public catalog</h1>';assert.deepEqual((await run([{...rows,minItems:0}])).result,{products:[]});
});
