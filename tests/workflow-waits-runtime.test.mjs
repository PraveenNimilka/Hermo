import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';
import {startRun,observeProgress} from '../server/run-state.mjs';

test('managed workflow waits observe real disposable page state and traffic without replaying actions',{timeout:90000},async t=>{
  const pages=new Map(),traffic=[];let engine,proxy;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://fixture');traffic.push({path:url.pathname,search:url.search,method:req.method});
    if(url.pathname==='/sandbox/data'){
      res.writeHead(Number(url.searchParams.get('status')??200),{'Content-Type':'text/plain'});res.end(req.method==='HEAD'?undefined:'controlled response');return;
    }
    if(url.pathname==='/sandbox/slow-image'){setTimeout(()=>{res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');},200);return;}
    const body=pages.get(url.pathname);res.writeHead(body?200:404,{'Content-Type':'text/html'});res.end(body??'Missing controlled fixture');
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
  proxy=await createEgressProxy(origin);engine=await createBrowserEngine(proxy,origin);
  t.after(async()=>{await engine?.closeAll();await proxy?.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
  const document=body=>`<!doctype html><html><head><title>Controlled wait fixture</title></head><body>${body}</body></html>`;
  const output='<output id="answer">Ready</output>';
  const addPage=body=>{const path='/sandbox/waits-'+randomUUID();pages.set(path,document(body));return origin+path;};
  async function run(body,steps,{inputs={},input={},outputs=[{name:'answer',selector:'#answer',type:'string'}],signal=new AbortController().signal,timeout=15000,onProgress=()=>{}}={}){
    const url=addPage(body),connection={id:'conn_workflow_waits_fixture',url,origins:[origin],access:'public',identity:{kind:'public_origin',origin}};
    const definition={version:'wait-runtime-fixture',inputs,steps,outputs,verifiers:outputs.map(field=>({kind:'nonempty',output:field.name})),effect:'retrieval',timeout_ms:timeout};
    const payload={},accepted=new Date().toISOString(),events=[];startRun(payload,definition,accepted);
    const promise=engine.execute(connection,definition,input,(index,total,event)=>{events.push({index,...event});observeProgress(payload,definition,index,total,event);onProgress(index,total,event);},signal);
    return {promise,payload,events};
  }

  await t.test('bounded delay and typed output conditions accept numeric zero and false',async()=>{
    const body='<output id="quantity">0</output><output id="flag">false</output>';
    const started=Date.now(),execution=await run(body,[{op:'wait_delay',duration_ms:150,timeout_ms:1500},{op:'wait_output',output:'quantity',predicate:'equals',value:0,timeout_ms:1500},{op:'wait_output',output:'flag',predicate:'equals',value:false,timeout_ms:1500},{op:'wait_output',output:'quantity',predicate:'nonempty',timeout_ms:1500}],{outputs:[{name:'quantity',selector:'#quantity',type:'number'},{name:'flag',selector:'#flag',type:'boolean'}]});
    const value=await execution.promise;assert.deepEqual(value.result,{quantity:0,flag:false});assert.ok(Date.now()-started>=150);assert.equal(execution.payload.steps.every(step=>step.status==='succeeded'),true);
  });

  await t.test('navigation wait observes the destination and page load completion',async()=>{
    const destination=addPage(output+'<img alt="" src="/sandbox/slow-image">');
    const execution=await run(`<a id="action" href="${destination}">Continue</a>${output}`,[{op:'click',selector:'#action'},{op:'wait_navigation',url:destination,state:'load',timeout_ms:2000}]);
    assert.deepEqual((await execution.promise).result,{answer:'Ready'});assert.equal(execution.payload.steps[1].status,'succeeded');
  });

  await t.test('a response received after the click but before the wait remains observable',async()=>{
    const before=traffic.length,resource=origin+'/sandbox/data?status=204&case=recent';
    const execution=await run(`<button id="action" onclick="fetch('/sandbox/data?status=204&case=recent',{method:'HEAD'}).then(()=>document.querySelector('#answer').textContent='Response observed')">Observe data</button>${output}`,[{op:'click',selector:'#action'},{op:'wait_text',selector:'#answer',text:'Response observed',timeout_ms:2000},{op:'wait_delay',duration_ms:150,timeout_ms:1000},{op:'wait_response',url:resource,method:'HEAD',status:204,timeout_ms:1000}]);
    assert.deepEqual((await execution.promise).result,{answer:'Response observed'});assert.equal(execution.payload.steps[3].status,'succeeded');
    assert.equal(traffic.slice(before).filter(value=>value.path==='/sandbox/data'&&value.search==='?status=204&case=recent'&&value.method==='HEAD').length,1,'Wait observation never repeats the request');
  });

  await t.test('request before the latest issued action cannot satisfy a later response wait',async()=>{
    const before=traffic.length,resource=origin+'/sandbox/data?case=earlier';
    const body=`<button id="action">Continue without another request</button>${output}<script>fetch('/sandbox/data?case=earlier').then(()=>document.querySelector('#answer').textContent='Earlier request finished')</script>`;
    const execution=await run(body,[{op:'wait_text',selector:'#answer',text:'Earlier request finished',timeout_ms:2000},{op:'click',selector:'#action'},{op:'wait_response',url:resource,method:'GET',timeout_ms:150,error_policy:'continue'}]);
    await execution.promise;assert.equal(execution.payload.steps[2].status,'skipped');assert.equal(execution.payload.steps[2].warning,'WAIT_TIMEOUT_CONTINUED');assert.equal(traffic.slice(before).filter(value=>value.path==='/sandbox/data'&&value.search==='?case=earlier').length,1);
  });

  await t.test('response matching checks status, method and complete URL independently',async()=>{
    const resource=origin+'/sandbox/data?status=201&case=matching';
    const execution=await run(`<button id="action" onclick="fetch('/sandbox/data?status=201&case=matching').then(()=>document.querySelector('#answer').textContent='Response ready')">Observe data</button>${output}`,[{op:'click',selector:'#action'},{op:'wait_text',selector:'#answer',text:'Response ready',timeout_ms:2000},{op:'wait_response',url:resource,method:'GET',status:200,timeout_ms:120,error_policy:'continue'},{op:'wait_response',url:resource,method:'HEAD',status:201,timeout_ms:120,error_policy:'continue'},{op:'wait_response',url:origin+'/sandbox/data?status=201&case=different',method:'GET',status:201,timeout_ms:120,error_policy:'continue'},{op:'wait_response',url:resource,method:'GET',status:201,timeout_ms:1000}]);
    await execution.promise;assert.deepEqual(execution.payload.steps.slice(2).map(step=>({status:step.status,warning:step.warning})),[{status:'skipped',warning:'WAIT_TIMEOUT_CONTINUED'},{status:'skipped',warning:'WAIT_TIMEOUT_CONTINUED'},{status:'skipped',warning:'WAIT_TIMEOUT_CONTINUED'},{status:'succeeded',warning:undefined}]);
    const denied=await run(output,[{op:'wait_response',url:'https://unapproved.example/data',method:'GET',timeout_ms:100,error_policy:'continue'}]);await assert.rejects(denied.promise,{message:'POLICY_BLOCKED'});
  });

  await t.test('stop waits fail and continued wait timeouts are visibly skipped without completing subsequent actions early',async()=>{
    const stop=await run(output,[{op:'wait_text',selector:'#answer',text:'Never present',timeout_ms:100,error_policy:'stop'}]);await assert.rejects(stop.promise,{message:'TIMEOUT'});assert.equal(stop.events.some(event=>event.warning==='WAIT_TIMEOUT_CONTINUED'),false);
    const continued=await run(`<button id="action" onclick="document.querySelector('#answer').textContent='Action completed'">Continue action</button>${output}`,[{op:'wait_text',selector:'#answer',text:'Never present',timeout_ms:100,error_policy:'continue'},{op:'click',selector:'#action'}]);
    assert.deepEqual((await continued.promise).result,{answer:'Action completed'});assert.equal(continued.payload.steps[0].status,'skipped');assert.equal(continued.payload.steps[0].warning,'WAIT_TIMEOUT_CONTINUED');assert.equal(continued.payload.steps[1].status,'succeeded');
  });

  await t.test('cancellation stops a continued wait and never reaches the later action',async()=>{
    const controller=new AbortController();let timer;
    const execution=await run(`<button id="action">Must not run</button>${output}`,[{op:'wait_delay',duration_ms:10000,timeout_ms:30000,error_policy:'continue'},{op:'click',selector:'#action'}],{signal:controller.signal,onProgress:(index,_total,event)=>{if(index===0&&!event)timer=setTimeout(()=>controller.abort(Error('WORKFLOW_CANCELLED')),100);}});
    try{await assert.rejects(execution.promise,{message:'WORKFLOW_CANCELLED'});assert.equal(execution.events.some(event=>event.warning==='WAIT_TIMEOUT_CONTINUED'),false);assert.equal(execution.payload.steps[1].status,'pending');}finally{clearTimeout(timer);}
  });

  await t.test('managed browser binds explicit nested scalar paths without stringifying objects',async()=>{
    const execution=await run(`<label for="query">Query</label><input id="query" oninput="document.querySelector('#answer').textContent=this.value">${output}`,[{op:'fill',selector:'#query',parameter:'request',value_path:['query']},{op:'wait_output',output:'answer',predicate:'equals',value:'A nested request'}],{inputs:{request:{type:'object',required:true,properties:{query:{type:'string',required:true}}}},input:{request:{query:'A nested request'}}});
    assert.deepEqual((await execution.promise).result,{answer:'A nested request'});
    const refused=await run(`<input id="query">${output}`,[{op:'fill',selector:'#query',parameter:'request'}],{inputs:{request:{type:'object',properties:{query:{type:'string'}}}},input:{request:{query:'Never stringify'}}});
    await assert.rejects(refused.promise,{message:'INVALID_WORKFLOW_INPUT'});
  });

  await t.test('native browser actions obey their own timeout and never continue or retry',async()=>{
    const execution=await run(`<button id="action" style="pointer-events:none">Blocked control</button>${output}`,[{op:'click',selector:'#action',timeout_ms:100},{op:'wait_delay',duration_ms:100}]);
    const began=Date.now();await assert.rejects(execution.promise,{message:'TIMEOUT'});assert.ok(Date.now()-began<2000);assert.equal(execution.payload.steps[1].status,'pending');
  });

  await t.test('the overall execution deadline cannot be downgraded to a continued wait timeout',async()=>{
    const execution=await run(`<button id="action">Must not run</button>${output}`,[{op:'wait_text',selector:'#answer',text:'Never present',timeout_ms:30000,error_policy:'continue'},{op:'click',selector:'#action'}],{timeout:15000});
    const began=Date.now();await assert.rejects(execution.promise,{message:'TIMEOUT'});assert.ok(Date.now()-began<17000,'The total deadline bounds the continued wait');assert.equal(execution.events.some(event=>event.warning==='WAIT_TIMEOUT_CONTINUED'),false);assert.equal(execution.payload.steps[1].status,'pending');
  });
});
