// Release acceptance against a separately installed candidate, not the owner workspace.
// Real Chromium + real HTTP owner recording/publication, with a synthetic website.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {chromium} from 'playwright';

const candidate=resolve(process.argv[2]??'work/release-candidate');
const directory=resolve('work/release-journey',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(directory,{recursive:true});
const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));
const origin='http://127.0.0.1:'+port,password=randomBytes(24).toString('hex');
const evidence={started_at:new Date().toISOString(),candidate,kind:'fresh-candidate-managed-journey',checks:[],limits:['Owned synthetic authenticated website; no paid provider or personal browser session used.','Onboarding uses rendered UI; recording and publication use the same owner HTTP controls used by the dashboard.','Selected Chrome workflows still require their original paired tab; restart independence is tested in managed mode.']};
let child,browser,page,cookie='',csrf='',key;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const save=()=>writeFileSync(join(directory,'result.json'),JSON.stringify(evidence,null,2));
const check=(name,value={})=>{evidence.checks.push({name,...value});save();console.log(name);};
const bootstrap=join(directory,'runtime.mjs');
writeFileSync(bootstrap,`import {createApp} from ${JSON.stringify(pathToFileURL(join(candidate,'server/index.mjs')).href)};
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const countFile=${JSON.stringify(join(directory,'website-count.json'))};
let count=existsSync(countFile)?JSON.parse(readFileSync(countFile,'utf8')):0;
const state=await createApp({port:${port},dataDir:${JSON.stringify(join(directory,'data'))}});
const document=body=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Release fixture</title></head><body>'+body+'</body></html>';
state.app.get('/sandbox/release',async(req,reply)=>reply.type('text/html').send(document(req.cookies.release_fixture==='synthetic-authorized-session'?'<div data-testid="account-identity">Alex Morgan · Release fixture</div><label for="message">Message</label><input id="message"><button id="submit">Submit synthetic form</button><p id="result">Pending</p><script src="/sandbox/release.js"></script>':'<h1>Fixture sign in</h1><form action="/sandbox/release-login" method="post"><button>Sign in to synthetic account</button></form>')));
state.app.post('/sandbox/release-login',async(req,reply)=>reply.setCookie('release_fixture','synthetic-authorized-session',{httpOnly:true,path:'/sandbox',sameSite:'strict',maxAge:3600}).redirect('/sandbox/release'));
state.app.get('/sandbox/release.js',async(req,reply)=>reply.type('application/javascript').send('document.querySelector("#submit").onclick=async()=>{const r=await fetch("/sandbox/release-submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:document.querySelector("#message").value})});document.querySelector("#result").textContent=(await r.json()).result}'));
state.app.post('/sandbox/release-submit',async(req,reply)=>{if(req.cookies.release_fixture!=='synthetic-authorized-session')return reply.code(401).send({error:'Login required'});count++;writeFileSync(countFile,JSON.stringify(count));return {result:req.body.message+' confirmed '+count};});
await state.app.listen({host:'127.0.0.1',port:${port}});
const stop=async()=>{await state.app.close();process.exit(0)};process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log('RELEASE_RUNTIME_READY');
`);
async function start(){
  let ready=false;const env={...process.env,HERMO_PORT:String(port),HERMO_DATA_DIR:join(directory,'data')};delete env.HERMO_MASTER_KEY;delete env.HERMO_BROWSER_PATH;
  child=spawn(process.execPath,[bootstrap],{cwd:candidate,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{if(data.toString().includes('RELEASE_RUNTIME_READY'))ready=true;});
  child.stderr.on('data',data=>writeFileSync(join(directory,'runtime-error.log'),data,{flag:'a'}));
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('Fresh runtime exited; see runtime-error.log');if(ready&&(await fetch(origin+'/health')).ok)return;await pause(100);}throw Error('Startup deadline');
}
async function stop(){if(child?.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill('SIGTERM');await exited;}}
async function call(path,body,headers={}){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{connection:'close',cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...headers},...body===undefined?{}:{body:JSON.stringify(body)},signal:AbortSignal.timeout(35000)});
  const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
}
async function finish(id,consumer=false){for(let i=0;i<300;i++){const run=await call((consumer?'/v1':'/studio')+'/runs/'+id,undefined,consumer?{authorization:'Bearer '+key}:{});if(['succeeded','failed','cancelled'].includes(run.status)){assert.equal(run.status,'succeeded',JSON.stringify(run));return run;}await pause(100);}throw Error('Run deadline');}
async function invoke(protocol,label){
  const headers={authorization:'Bearer '+key};let receipt;
  if(protocol==='REST')receipt=await call('/v1/actions/release.submit/versions/1/runs',{input:{message:label}},{...headers,'idempotency-key':randomUUID()});
  else{const response=await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'action_release_submit',arguments:{input:{message:label},request_id:randomUUID()}}},{...headers,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'});assert.ok(!response.error,JSON.stringify(response));receipt=response.result.structuredContent;}
  const run=await finish(receipt.run_id,true);assert.ok(run.result.response.startsWith(label+' confirmed '));check(protocol+' '+label,{status:run.status,duration_ms:run.duration_ms,run_id:run.id});
}
try{
  assert.ok(!existsSync(join(directory,'data')));await start();check('Fresh installed candidate starts without workspace data or configured key');
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1365,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.getByLabel('Create a workspace password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create private workspace',exact:true}).click();await page.getByRole('button',{name:'Connections',exact:true}).waitFor();
  await page.screenshot({path:join(directory,'fresh-workspace.png')});
  cookie=(await page.context().cookies(origin+'/studio')).map(item=>item.name+'='+item.value).join('; ');csrf=(await call('/studio/session')).csrf;
  check('Rendered first-run UI creates owner workspace using default Windows DPAPI');assert.ok(existsSync(join(directory,'data/master.dpapi')));
  const connection=(await call('/studio/connections',{name:'Release authenticated website',url:origin+'/sandbox/release',browser_mode:'isolated',access:'account',authorized:true})).connection,base='/studio/connections/'+connection.id;
  await call(base+'/open',{});let view=await call(base+'/browser');const signIn=view.elements.find(item=>item.label==='Sign in to synthetic account');assert.ok(signIn);await call(base+'/control',{element_id:signIn.id,kind:'click'});
  view=await call(base+'/browser');const identity=view.elements.find(item=>item.preview==='Alex Morgan · Release fixture');assert.ok(identity);await call(base+'/confirm',{element_id:identity.id});check('Explicitly authorized website login and account identity confirmed');
  const recording=await call('/studio/recordings',{connection_id:connection.id,name:'Release form submission',slug:'release.submit',action_type:'submit_form'});
  const control=async(label,kind,extra={})=>{const view=await call(base+'/browser'),element=view.elements.find(item=>item.label===label);assert.ok(element,label);await call(base+'/control',{recording_id:recording.id,element_id:element.id,kind,...extra});};
  await control('Message','fill',{value:'recorded',parameter:'message'});await control('Submit synthetic form','click');
  let output;for(let i=0;i<80&&!output;i++){view=await call(base+'/browser');output=view.elements.find(item=>item.preview==='recorded confirmed 1');if(!output)await pause(100);}assert.ok(output);
  await call('/studio/recordings/'+recording.id+'/output',{element_id:output.id,name:'response'});
  const workflow=(await call('/studio/recordings/'+recording.id+'/finish',{verifiers:[{kind:'changed',output:'response'}],timeout_seconds:20})).workflow;
  await finish((await call('/studio/workflows/'+workflow.id+'/test',{input:{message:'verify'}})).run_id);
  const review=await call('/studio/workflows/'+workflow.id+'/permissions');assert.equal(review.network_interactions.restriction,'authorized_origins_http_and_wss');
  key=(await call('/studio/workflows/'+workflow.id+'/publish',{expected_version:review.version,permission_fingerprint:review.fingerprint})).key;check('Recorded real form action, verified fresh output and published reviewed immutable workflow');
  await invoke('REST','before close');await invoke('MCP','before close');
  await call(base+'/close',{});await page.close();await browser.close();browser=undefined;check('Original managed website tab and owner dashboard closed');
  await invoke('REST','after tab close');await invoke('MCP','after tab close');
  await stop();cookie='';csrf='';await start();const locked=await fetch(origin+'/studio/overview');assert.equal(locked.status,401);check('New runtime process starts locked against same DPAPI-protected workspace');
  await invoke('REST','after restart');await invoke('MCP','after restart');
  assert.equal(JSON.parse(readFileSync(join(directory,'website-count.json'),'utf8')),8,'One recording, one verification and six consumer invocations; no duplicate submissions');
  assert.deepEqual(errors,[]);check('Eight submissions exactly; no duplicate replay or rendered UI exceptions');evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure={message:error.message};console.error(error);process.exitCode=1;}
finally{await browser?.close();await stop();evidence.finished_at=new Date().toISOString();save();console.log('Release journey evidence: '+directory);}
