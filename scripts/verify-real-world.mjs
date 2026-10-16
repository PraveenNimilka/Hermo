// Real external acceptance tests. Owner provisioning uses public Studio HTTP
// routes; consumer calls use scoped REST/MCP keys. Never touches the owner DB.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'node:net';

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const portProbe=createServer();await new Promise(done=>portProbe.listen(0,'127.0.0.1',done));
const port=portProbe.address().port;await new Promise(done=>portProbe.close(done));
const directory=resolve('work/real-world',stamp),origin=`http://127.0.0.1:${port}`;
mkdirSync(directory,{recursive:true});mkdirSync('validation/results',{recursive:true});
const evidence={tested_at:new Date().toISOString(),kind:'live-external-websites',runtime:origin,site_rules:'https://toscrape.com/',applications:[],checks:[],limitations:[]};
const password=randomBytes(24).toString('hex'),master=randomBytes(32).toString('base64');
let child,cookie='',csrf='';
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const save=()=>writeFileSync(`validation/results/real-world-${stamp}.json`,JSON.stringify(evidence,null,2));
async function start(){
  let announced=false;
  child=spawn(process.execPath,['server/index.mjs'],{cwd:resolve('.'),env:{...process.env,HERMO_PORT:String(port),HERMO_DATA_DIR:directory,HERMO_MASTER_KEY:master},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',data=>{if(data.toString().includes('Hermo is running at '+origin))announced=true;process.stdout.write(data);});child.stderr.on('data',data=>process.stderr.write(data));
  await sleep(500);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Isolated runtime failed');try{if(announced&&(await fetch(origin+'/health')).ok)return;}catch{}await sleep(200);}throw Error('Runtime startup timed out');
}
async function stop(){if(child?.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await exited;}}
async function request(path,body,{key,method,headers={},allowFailure=false}={}){
  const owner=path.startsWith('/studio/');
  const response=await fetch(origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{...(owner?{cookie,'x-hermo-csrf':csrf}:{}),...(key?{authorization:'Bearer '+key}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
  if(owner&&response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const value=await response.json();if(!allowFailure)assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return {status:response.status,value};
}
const owner=async(path,body)=>(await request(path,body)).value;
async function login(setup=false){cookie='';csrf=(await owner('/studio/session')).csrf;csrf=(await owner('/studio/'+(setup?'setup':'login'),{password})).csrf;}
async function wait(receipt,key){for(let i=0;i<130;i++){const value=(await request((key?'/v1':'/studio')+'/runs/'+receipt.run_id,undefined,{key})).value;if(['succeeded','failed','cancelled'].includes(value.status))return value;await sleep(750);}throw Error('Run polling deadline');}
const run=async(item,input,options={})=>wait((await request(`/v1/actions/${item.slug}/versions/1/runs`,{input},{key:item.key,headers:{'idempotency-key':randomUUID()},...options})).value,item.key);
function record(label,value){const safe={label,id:value.id,status:value.status,revision:value.workflow_revision,version:value.workflow_version,execution_mode:value.execution_mode,created_at:value.created_at,verification:value.verification,error:value.error,queue_duration_ms:value.queue_duration_ms,duration_ms:value.duration_ms,steps:value.steps};evidence.checks.push(safe);save();return value;}
async function build(spec){
  console.log('Provisioning '+spec.slug);
  const c=(await owner('/studio/connections',{name:spec.name,url:spec.url,browser_mode:'isolated',access:'public',authorized:true})).connection;
  await owner(`/studio/connections/${c.id}/open`,{});
  await owner(`/studio/connections/${c.id}/confirm`,{public_source:true});
  const rec=await owner('/studio/recordings',{connection_id:c.id,name:spec.name,slug:spec.slug,action_type:'read_data'});
  await owner(`/studio/recordings/${rec.id}/navigate`,{template:spec.template,parameter:spec.parameter,example:spec.samples[0]});
  await owner(`/studio/recordings/${rec.id}/output`,{source:'url_parameter',name:spec.parameter});
  const w=(await owner(`/studio/recordings/${rec.id}/finish`,{verifiers:[{output:spec.parameter,input:spec.parameter}]})).workflow;
  const base=`/studio/workflows/${w.id}`;const editor=await owner(base+'/editor');
  const edited=await owner(base+'/editor',{expected_version:editor.version,steps:[...editor.definition.steps,{op:'wait_element',selector:spec.wait,state:'visible',timeout_ms:10000}],inputs:editor.definition.inputs,outputs:[...editor.definition.outputs,...spec.outputs],verifiers:[...editor.definition.verifiers,{kind:'nonempty',output:spec.collection}],timeout_seconds:45});
  const test=record(spec.slug+' owner test',await wait(await owner(base+'/test',{input:{[spec.parameter]:spec.samples[0]}})));
  assert.equal(test.status,'succeeded',JSON.stringify(test));
  const publication=await owner(base+'/publish',{}),item={...spec,id:w.id,cid:c.id,key:publication.key,key_id:publication.id,version:edited.version};
  await owner(`/studio/connections/${c.id}/close`,{});
  const contract=(await request('/v1/action-contract',undefined,{key:item.key})).value;
  assert.equal(contract.output_schema.properties[spec.collection].type,'array');item.contract=contract;
  return item;
}

const specs=[{
  name:'Public product catalog',slug:'validation.products',url:'https://books.toscrape.com/',template:'https://books.toscrape.com/catalogue/category/books/{category}/index.html',parameter:'category',samples:['travel_2','mystery_3'],wait:'.page-header h1',collection:'products',
  outputs:[{name:'products',type:'array',selector:'.product_pod',maxItems:20,items:{type:'object',fields:[{name:'title',selector:'h3 a'},{name:'price',selector:'.price_color'},{name:'availability',selector:'.availability'},{name:'url',type:'url',selector:'h3 a',read_attribute:'href'},{name:'description',selector:'.product-description',required:false}]}},{name:'metadata',type:'object',fields:[{name:'heading',selector:'h1'}]}]
},{
  name:'Public paginated quotes',slug:'validation.quotes',url:'https://quotes.toscrape.com/',template:'https://quotes.toscrape.com/page/{page}/',parameter:'page',samples:['1','2'],wait:'h1',collection:'quotes',
  outputs:[{name:'quotes',type:'array',selector:'.quote',maxItems:10,items:{type:'object',fields:[{name:'text',selector:'.text'},{name:'author',selector:'.author'},{name:'tags',type:'array',selector:'.tags .tag',minItems:0,maxItems:20,items:{type:'string'}},{name:'source',type:'url',selector:'.source',read_attribute:'href',required:false}]}},{name:'metadata',type:'object',fields:[{name:'heading',selector:'h1'}]}]
}];

try{
  await start();await login(true);const products=await build(specs[0]),quotes=await build(specs[1]);
  const items={products,quotes};
  // Private credentials only in ignored work/, for manual UI acceptance during this run.
  writeFileSync(resolve(directory,'consumer-config.json'),JSON.stringify({origin,items,password},null,2));
  console.log('Private consumer configuration: '+resolve(directory,'consumer-config.json'));
  const p1=record('products travel',await run(products,{category:'travel_2'}));assert.equal(p1.status,'succeeded');
  const p2=record('products mystery',await run(products,{category:'mystery_3'}));assert.equal(p2.status,'succeeded');assert.notDeepEqual(p1.result.products,p2.result.products);
  assert.ok(p1.result.products.every(p=>p.url.startsWith('https://books.toscrape.com/')));
  const q1=record('quotes page 1',await run(quotes,{page:'1'}));assert.equal(q1.status,'succeeded');assert.equal(q1.result.quotes.length,10);assert.ok(Array.isArray(q1.result.quotes[0].tags));
  const q2=record('quotes page 2',await run(quotes,{page:'2'}));assert.equal(q2.status,'succeeded');assert.notDeepEqual(q1.result.quotes,q2.result.quotes);
  const repeat=record('change detector unchanged observation',await run(products,{category:'travel_2'}));assert.equal(repeat.status,'succeeded');assert.deepEqual(repeat.result,p1.result);assert.notEqual(repeat.id,p1.id);assert.notEqual(repeat.verification.observed_at,p1.verification.observed_at);
  const negative=[['invalid input',products,{category:'../private'},products.key,400],['invalid key',products,{category:'travel_2'},'hm_live_'+ 'x'.repeat(43),401],['wrong scope',quotes,{page:'1'},products.key,403]];
  for(const [label,item,input,key,status]of negative){const r=await request(`/v1/actions/${item.slug}/versions/1/runs`,{input},{key,headers:{'idempotency-key':randomUUID()},allowFailure:true});assert.equal(r.status,status);evidence.checks.push({label,http_status:r.status,error:r.value.error});}
  const missing=record('missing record',await run(products,{category:'UNKNOWN-RECORD'}));assert.equal(missing.status,'failed');assert.equal(missing.result,undefined);
  const revoked=await owner('/studio/keys',{workflow_id:products.id,name:'Revocation acceptance key'});await owner(`/studio/keys/${revoked.id}/revoke`,{});
  const revokedResult=await request(`/v1/actions/${products.slug}/versions/1/runs`,{input:{category:'travel_2'}},{key:revoked.key,headers:{'idempotency-key':randomUUID()},allowFailure:true});assert.equal(revokedResult.status,401);evidence.checks.push({label:'revoked key',http_status:401,error:revokedResult.value.error});
  const idem=randomUUID(),admit=()=>request(`/v1/actions/${products.slug}/versions/1/runs`,{input:{category:'travel_2'}},{key:products.key,headers:{'idempotency-key':idem}});
  const first=(await admit()).value,duplicate=(await admit()).value;assert.equal(first.run_id,duplicate.run_id);record('idempotent receipt',await wait(first,products.key));
  const simultaneous=await Promise.all([run(quotes,{page:'1'}),run(quotes,{page:'2'})]);simultaneous.forEach((r,i)=>{record('bounded concurrent '+i,r);assert.equal(r.status,'succeeded');});
  const ordered=simultaneous.toSorted((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at));assert.ok(Date.parse(ordered[1].started_at)>=Date.parse(ordered[0].finished_at));
  const base=`/studio/workflows/${quotes.id}`;await owner(base+'/draft',{expected_version:quotes.version});const edit=await owner(base+'/editor');
  const changed=await owner(base+'/editor',{expected_version:edit.version,steps:edit.definition.steps.map(step=>step.op==='wait_element'?{...step,timeout_ms:12000}:step),inputs:edit.definition.inputs,outputs:edit.definition.outputs,verifiers:edit.definition.verifiers,timeout_seconds:45});
  const stable=record('published stable during draft',await run(quotes,{page:'1'}));assert.equal(stable.workflow_revision,1);
  assert.equal(record('edited real draft test',await wait(await owner(base+'/test',{input:{page:'2'}}))).status,'succeeded');
  await owner(base+'/publish',{});const revision2=record('published revision 2',await run(quotes,{page:'2'}));assert.equal(revision2.workflow_revision,2);
  await owner(base+'/rollback',{revision:1,expected_active_revision:2});assert.equal(record('rollback revision 1',await run(quotes,{page:'1'})).workflow_revision,1);
  await stop();await start();await login();const restart=record('managed after process restart, no original browser',await run(products,{category:'travel_2'}));assert.equal(restart.status,'succeeded');assert.equal(restart.execution_mode,'managed_local');
  evidence.workflows=[products,quotes].map(({id,slug,template,contract})=>({id,slug,template,contract}));
  evidence.limitations.push('Connected Chrome live external authorization, real model invocation and authenticated external managed session tests require separately authorized sessions; not claimed by this harness.');
  evidence.completed_at=new Date().toISOString();save();
  console.log('Core live acceptance passed. Evidence written.');
  if(process.argv.includes('--keep-running')){console.log('Isolated runtime retained for consumer UI acceptance; interrupt this script to stop.');await new Promise(resolve=>process.once('SIGINT',resolve));}
}catch(error){evidence.failure={message:error.message};save();console.error(error);process.exitCode=1;}finally{await stop();save();}
