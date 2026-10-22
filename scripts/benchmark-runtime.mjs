import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve,dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {createBrowserEngine} from '../server/browser.mjs';
import {convertOutputs} from '../server/workflow-contract.mjs';

const destination=resolve(process.argv[2]??'work/runtime-benchmark.json'),dataDir=resolve('work/runtime-benchmark',randomUUID());
const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));
process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
const started=performance.now(),cpu=process.cpuUsage();let browserVersion;
const state=await createApp({port,dataDir,browserEngineFactory:(proxy,origin,options)=>createBrowserEngine(proxy,origin,{...options,launchBrowser:async options=>{const browser=await chromium.launch(options);browserVersion=browser.version();return browser;}})});
const {app,store,origin}=state;let cookie='',csrf='';
app.get('/sandbox/benchmark/:record',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Runtime benchmark</title><output id="value">42</output>'));
const result={measured_at:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,startup_ms:performance.now()-started,samples:6,notes:['Node process CPU and memory exclude Chromium child processes.','Observed local fixture timings; not a controlled benchmark or a public-site performance guarantee.']};
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,min:sorted[0],median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)],max:sorted.at(-1)};};
// The benchmark owner explicitly reviews and authorizes its controlled publication.
async function call(path,body,key){
  if(!key&&body!==undefined&&/^\/studio\/workflows\/[^/]+\/publish$/.test(path)){const review=await call(path.replace(/\/publish$/,'/permissions'));body={expected_version:review.version,permission_fingerprint:review.fingerprint,...(review.changes?.breaking?{change_fingerprint:review.changes.fingerprint,accept_breaking:true}:{}),...body};}
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...key?{authorization:'Bearer '+key}:{cookie,'x-hermo-csrf':csrf},...body===undefined?{}:{'content-type':'application/json'},...key&&body!==undefined?{'idempotency-key':randomUUID()}:{}},...body===undefined?{}:{body:JSON.stringify(body)}});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,error:value.error}));return value;
}
async function terminal(id,key){for(let i=0;i<150;i++){const value=await call((key?'/v1':'/studio')+'/runs/'+id,undefined,key);if(['succeeded','failed','cancelled'].includes(value.status))return value;await new Promise(done=>setTimeout(done,1000));}throw Error('Benchmark run did not settle');}
try{
  await app.listen({port,host:'127.0.0.1'});
  csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-runtime-benchmark-password'})).csrf;
  const health=[];for(let i=0;i<30;i++){const t=performance.now();await call('/health');health.push(performance.now()-t);}result.health_http_ms=summary(health);
  const connection=(await call('/studio/connections',{name:'Runtime benchmark',url:origin+'/sandbox/benchmark/row_1',access:'public',browser_mode:'isolated',authorized:true})).connection;
  const opened=performance.now();await call(`/studio/connections/${connection.id}/open`,{});result.browser_open_ms=performance.now()-opened;
  await call(`/studio/connections/${connection.id}/confirm`,{public_source:true});
  const recording=await call('/studio/recordings',{connection_id:connection.id,name:'Runtime benchmark',slug:'benchmark.read',action_type:'read_data'});
  const snapshot=await call(`/studio/connections/${connection.id}/browser`),element=snapshot.elements.find(item=>item.kind==='output'&&item.preview==='42');assert.ok(element);
  await call(`/studio/recordings/${recording.id}/output`,{element_id:element.id,name:'value'});
  const workflow=(await call(`/studio/recordings/${recording.id}/finish`,{verifiers:[{kind:'nonempty',output:'value'}]})).workflow,base='/studio/workflows/'+workflow.id,editor=await call(base+'/editor');
  await call(base+'/editor',{expected_version:editor.version,steps:editor.definition.steps,inputs:editor.definition.inputs,outputs:[{...editor.definition.outputs[0],type:'number'}],verifiers:editor.definition.verifiers,timeout_seconds:30});
  assert.equal((await terminal((await call(base+'/test',{input:{}})).run_id)).status,'succeeded');
  const key=(await call(base+'/publish',{})).key;
  await call(`/studio/connections/${connection.id}/close`,{});
  const admission=[],receipts=[];
  for(let i=0;i<result.samples;i++){const t=performance.now();receipts.push(await call('/v1/actions/benchmark.read/versions/1/runs',{input:{}},key));admission.push(performance.now()-t);}
  const runs=await Promise.all(receipts.map(receipt=>terminal(receipt.run_id,key)));
  runs.forEach(run=>{assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(run.result.value,42);});
  result.admission_http_ms=summary(admission);result.queue_wait_ms=summary(runs.map(run=>run.queue_duration_ms));result.execution_ms=summary(runs.map(run=>run.execution_ms));
  const dbStart=performance.now();for(let i=0;i<1000;i++)store.db.prepare('SELECT status FROM runs WHERE id=?').get(runs[i%runs.length].id);result.sqlite_1000_reads_ms=performance.now()-dbStart;
  const mapping=[{name:'records',type:'array',maxItems:100,items:{type:'object',fields:[{name:'name',type:'string'},{name:'price',type:'number'}]}}],raw={records:Array.from({length:100},(_,i)=>({name:'Item '+i,price:String(i+.5)}))},timings=[];
  for(let i=0;i<1200;i++){const t=performance.now();convertOutputs(mapping,raw);if(i>=200)timings.push(performance.now()-t);}result.convert_100_rows_ms=summary(timings);
  result.memory=process.memoryUsage();result.cpu_us=process.cpuUsage(cpu);result.browser=browserVersion;result.total_ms=performance.now()-started;
  mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await app.close();}
