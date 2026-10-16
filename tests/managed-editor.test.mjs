import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('managed local APIs execute repaired semantic steps and explicit waits after Studio closes',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const {app,store,origin}=await createApp({port:4428,dataDir:resolve('work/managed-editor',randomBytes(6).toString('hex'))});
  let mutations=0;
  app.get('/sandbox/managed-editor',async(req,reply)=>reply.header('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; form-action 'self'").type('text/html').send(`<h1>Catalog fixture</h1><form><label for="query">Search query</label><input name="q" id="query"><button data-testid="search">Search</button></form><div id="loading">Loading</div><div id="answer" hidden></div><button class="duplicate">One</button><button class="duplicate">Two</button><script>setTimeout(()=>{document.querySelector('#loading').remove();const result=document.querySelector('#answer');result.textContent=new URL(location.href).searchParams.get('q')||'Initial';result.hidden=false},120)</script>`));
  app.post('/sandbox/managed-mutation',async()=>{mutations++;return {ok:true};});
  await app.listen({host:'127.0.0.1',port:4428});
  let cookie='',csrf='';
  const call=async(path,body,headers={})=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:4428',cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];return {status:response.statusCode,value:response.json()};};
  const ok=async(...args)=>{const value=await call(...args);assert.ok(value.status<300,JSON.stringify(value));return value.value;};
  const finish=async rid=>{for(let n=0;n<200;n++){const run=await ok('/studio/runs/'+rid);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(done=>setTimeout(done,100));}assert.fail('Run did not finish');};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-managed-fixture-owner'})).csrf;
    const c=(await ok('/studio/connections',{name:'Managed catalog',url:origin+'/sandbox/managed-editor',browser_mode:'isolated',access:'public',authorized:true})).connection;
    const config=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(c.id).payload);
    store.db.prepare("UPDATE connections SET status='connected',payload=? WHERE id=?").run(store.seal({...config,identity:{kind:'public_origin',origin},checkpoint:config.url}),c.id);
    const definition={steps:[],inputs:{query:{type:'string',required:true}},outputs:[{name:'answer',type:'string',selector:'#answer'}],verifiers:[{kind:'equals_input',output:'answer',input:'query'}],effect:'retrieval',action_type:'search',timeout_ms:15000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_managed',c.id,'Catalog search','managed.catalog','draft',definition.version,store.seal(definition),null,new Date().toISOString());
    const base='/studio/workflows/wf_managed',loaded=await ok(base+'/editor');
    assert.equal(loaded.execution_mode,'managed_local');
    const steps=[{op:'fill',locators:[{kind:'label',value:'Search query'}],parameter:'query'},{op:'click',locators:[{kind:'testId',value:'search'}]},{op:'wait_element',selector:'#loading',state:'hidden',timeout_ms:2000},{op:'wait_text',selector:'#answer',text:'books',timeout_ms:2000},{op:'click',selector:'#missing',enabled:false}];
    const saved=await ok(base+'/editor',{expected_version:loaded.version,steps,inputs:definition.inputs,outputs:definition.outputs,verifiers:definition.verifiers,timeout_seconds:15});
    assert.equal(saved.workflow.tested,false);
    assert.equal((await call(base+'/editor',{expected_version:'stale',steps,inputs:definition.inputs,outputs:definition.outputs,verifiers:definition.verifiers,timeout_seconds:15})).value.error.code,'VERSION_CHANGED');
    const tested=await finish((await ok(base+'/test',{input:{query:'books'}})).run_id);
    assert.equal(tested.status,'succeeded',JSON.stringify(tested));assert.equal(tested.steps[4].status,'skipped');
    // Select a separately authorized execution connection. An earlier test of
    // the recording connection is not evidence for the target browser.
    const target=(await ok('/studio/connections',{name:'Dedicated execution target',url:config.url,browser_mode:'isolated',access:'public',authorized:true})).connection;
    const targetConfig=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(target.id).payload);
    store.db.prepare("UPDATE connections SET status='connected',payload=? WHERE id=?").run(store.seal({...targetConfig,identity:{kind:'public_origin',origin},checkpoint:config.url}),target.id);
    const modes=await ok(base+'/execution');assert.equal(modes.targets.length,2);
    const otherProject=(await ok('/studio/projects',{name:'Isolated project'})).project;
    const foreign=(await ok('/studio/connections',{name:'Other project target',url:config.url,browser_mode:'isolated',access:'public',authorized:true})).connection;
    await ok(`/studio/connections/${foreign.id}/project`,{project_id:otherProject.id});
    const otherOrigin=(await ok('/studio/connections',{name:'Other origin target',url:'https://example.com',browser_mode:'isolated',access:'public',authorized:true})).connection;
    for(const candidate of [foreign,otherOrigin])assert.equal((await call(base+'/execution',{expected_version:saved.version,connection_id:candidate.id,authorized:true})).value.error.code,'EXECUTION_PERMISSION_CHANGED');
    assert.equal((await call(base+'/execution',{expected_version:saved.version,connection_id:target.id,authorized:true},{'x-hermo-csrf':'wrong'})).status,403);
    assert.equal((await call(base+'/execution',{expected_version:'old',connection_id:target.id,authorized:true})).value.error.code,'VERSION_CHANGED');
    const bound=await ok(base+'/execution',{expected_version:saved.version,connection_id:target.id,authorized:true});
    assert.equal(bound.execution_mode,'managed_local');assert.equal((await call(base+'/publish',{})).value.error.code,'TEST_REQUIRED');
    assert.equal((await call(`/studio/connections/${target.id}/project`,{project_id:otherProject.id})).value.error.code,'EXECUTION_TARGET_BOUND');
    const targetTest=await finish((await ok(base+'/test',{input:{query:'books'}})).run_id);assert.equal(targetTest.status,'succeeded',JSON.stringify(targetTest));
    const publication=await ok(base+'/publish',{}),auth={authorization:'Bearer '+publication.key};
    assert.equal((await call(`/studio/connections/${target.id}/remove`,{authorized:true,confirmation:'Delete "Dedicated execution target"'})).value.error.code,'CONNECTION_IN_USE');
    // Closing the owner's preview does not terminate the independently executed API.
    await ok(`/studio/connections/${c.id}/close`,{});
    const run=await finish((await ok('/v1/actions/managed.catalog/versions/1/runs',{input:{query:'books'}},{...auth,'idempotency-key':'managed-after-preview-close'})).run_id);
    assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.execution_mode,'managed_local');assert.equal(run.workflow_revision,1);assert.deepEqual(run.result,{answer:'books'});
    const snapshot=store.unseal(store.db.prepare('SELECT payload FROM run_snapshots WHERE run_id=?').get(run.id).payload);assert.equal(snapshot.definition.steps[0].locators[0].kind,'label');assert.equal(snapshot.connection_config.id,target.id);
    assert.equal(mutations,0);
    await ok(base+'/draft',{expected_version:bound.version});
    const current=await ok(base+'/editor');
    await ok(base+'/editor',{expected_version:current.version,steps:[{op:'click',selector:'.duplicate'}],inputs:{},outputs:definition.outputs,verifiers:[],timeout_seconds:15});
    const ambiguous=await finish((await ok(base+'/test',{input:{}})).run_id);assert.equal(ambiguous.error.code,'ELEMENT_AMBIGUOUS');
    const current2=await ok(base+'/editor');
    assert.equal((await call(base+'/editor',{expected_version:current2.version,steps:[{op:'navigate',url:origin+'/studio/privacy-export'}],inputs:{},outputs:definition.outputs,verifiers:[],timeout_seconds:15})).value.error.code,'INVALID_WORKFLOW_CONTRACT');
  }finally{await app.close();}
});

test('dedicated managed sessions rotate securely and survive runtime restart',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/managed-session',randomBytes(6).toString('hex')),port=4429;
  let state,csrf='',cookie='';
  async function start(){
    state=await createApp({port,dataDir});
    state.app.get('/sandbox/managed-private',async(req,reply)=>{if(!['initial','rotated'].includes(req.cookies.managed_session))return reply.type('text/html').send('<input type="password" aria-label="Sign in">');return reply.setCookie('managed_session','rotated',{path:'/sandbox/',httpOnly:true,sameSite:'lax'}).type('text/html').send('<span id="account">Fixture owner</span><output id="value">42</output>');});
    await state.app.listen({host:'127.0.0.1',port});
  }
  const call=async(path,body,headers={})=>{const response=await state.app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
  const finish=async rid=>{for(let n=0;n<200;n++){const run=await call('/studio/runs/'+rid);if(['succeeded','failed'].includes(run.status))return run;await new Promise(done=>setTimeout(done,100));}assert.fail('Run did not finish');};
  try{
    await start();csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-managed-private-owner'})).csrf;
    const {store,origin}=state,cid='conn_private',wid='wf_private',when=new Date().toISOString();
    const connection={url:origin+'/sandbox/managed-private',origins:[origin],access:'account',browser_mode:'isolated',checkpoint:origin+'/sandbox/managed-private',identity:{selector:'#account',text:'Fixture owner'},storageState:{cookies:[{name:'managed_session',value:'initial',domain:'127.0.0.1',path:'/sandbox/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Dedicated private fixture',connection.url,'connected',store.seal(connection),when);
    const definition={steps:[],inputs:{},outputs:[{name:'value',selector:'#value',type:'number'}],verifiers:[],effect:'retrieval'};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Private value','managed.private','draft',definition.version,store.seal(definition),null,when);
    const run=await finish((await call(`/studio/workflows/${wid}/test`,{input:{}})).run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));
    const rotated=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(cid).payload);
    assert.equal(rotated.storageState.cookies.find(item=>item.name==='managed_session').value,'rotated');
    const published=await call(`/studio/workflows/${wid}/publish`,{}),auth={authorization:'Bearer '+published.key};
    await state.app.close();await start();cookie='';csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/login',{password:'synthetic-managed-private-owner'})).csrf;
    const restored=await finish((await call('/v1/actions/managed.private/versions/1/runs',{input:{}},{...auth,'idempotency-key':'after-restart'})).run_id);
    assert.equal(restored.status,'succeeded',JSON.stringify(restored));assert.deepEqual(restored.result,{value:42});assert.equal(JSON.stringify(restored).includes('managed_session'),false);
    const stored=state.store.unseal(state.store.db.prepare('SELECT payload FROM connections WHERE id=?').get(cid).payload);stored.storageState={cookies:[],origins:[]};state.store.db.prepare('UPDATE connections SET payload=? WHERE id=?').run(state.store.seal(stored),cid);
    const expired=await finish((await call('/v1/actions/managed.private/versions/1/runs',{input:{}},{...auth,'idempotency-key':'expired-session'})).run_id);assert.equal(expired.status,'failed');assert.equal(expired.error.category,'AUTHENTICATION_REQUIRED');
  }finally{await state?.app.close();}
});
