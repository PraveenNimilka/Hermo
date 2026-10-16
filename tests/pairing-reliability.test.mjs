import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash,openStore} from '../server/store.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check,timeout=4000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await pause(20);}assert.fail('Condition did not settle');}

async function fixture(port,close=async()=>{},extraEngine={}){
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const engine={close,closeAll:async()=>{},closeStudios:async()=>{},isOpen:()=>false,...extraEngine},dataDir=resolve('work/pairing-reliability',randomBytes(6).toString('hex'));
  const state=await createApp({port,dataDir,browserEngineFactory:async()=>engine});
  let cookie='',csrf='';
  const call=async(path,body,extra={})=>{
    const response=await state.app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...extra},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-local-pairing-test-password'})).csrf;
  const extension={'x-hermo-extension-id':'a'.repeat(32),origin:'chrome-extension://'+'a'.repeat(32),cookie:''};
  function seed(cid){state.store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Fixture '+cid,state.origin+'/sandbox/','connected',state.store.seal({url:state.origin+'/sandbox/',checkpoint:state.origin+'/sandbox/',origins:[state.origin],access:'public',browser_mode:'connected',identity:{kind:'selected_tab',origin:state.origin}}),new Date().toISOString());}
  const body=code=>({code,origin:state.origin,authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard'],tab_id:1,context_id:'bc_'+'b'.repeat(36)});
  const grant=cid=>ok(`/studio/connections/${cid}/browser-link`,{authorized:true});
  return {...state,dataDir,call,ok,seed,grant,body,extension};
}

test('pairing consumes codes and reserves the physical tab across asynchronous browser closure',{timeout:15000},async()=>{
  const gates=new Map(),f=await fixture(4413,cid=>new Promise(resolve=>gates.set(cid,resolve)));
  try{
    f.seed('one');f.seed('two');
    const a=await f.grant('one'),b=await f.grant('two');
    const old=await f.call('/companion/browser/pair',{...f.body(a.code),capabilities:['panel','read_data','saved_browser']},f.extension);
    assert.equal(old.status,426);assert.equal(old.value.error.code,'COMPANION_UPDATE_REQUIRED');
    const first=f.call('/companion/browser/pair',f.body(a.code),f.extension);await until(()=>gates.has('one'));
    assert.equal((await f.call('/companion/browser/pair',f.body(a.code),f.extension)).status,401,'the code is consumed before awaiting browser closure');
    assert.equal((await f.call('/companion/browser/pair',f.body(b.code),f.extension)).value.error.code,'TAB_ALREADY_CONNECTED');
    assert.equal((await f.call('/studio/recordings',{connection_id:'one',name:'Conflicting recording',slug:'conflicting.record'})).value.error.code,'BROWSER_BUSY');
    gates.get('one')();const paired=await first;assert.equal(paired.status,200);
    assert.equal((await f.call('/companion/browser/pair',f.body(b.code),f.extension)).value.error.code,'TAB_ALREADY_CONNECTED');
    // A different tab can pair, but explicit Lock during its await must revoke it.
    const pending=f.call('/companion/browser/pair',{...f.body(b.code),tab_id:2},f.extension);await until(()=>gates.has('two'));
    await f.ok('/studio/logout',{});gates.get('two')();assert.equal((await pending).status,401);
    assert.equal((await f.call('/companion/browser/poll',{}, {...f.extension,authorization:'Bearer '+paired.value.token})).status,401);
  }finally{for(const release of gates.values())release();await f.app.close();}
});

test('connected timeouts preserve uncertain submission evidence and fail queued work without repeating a command',{timeout:25000},async()=>{
  const f=await fixture(4414),{db,seal,unseal}=f.store;
  const run=rid=>{const row=db.prepare('SELECT * FROM runs WHERE id=?').get(rid);return {...row,...unseal(row.payload)};};
  try{
    f.seed('website');const grant=await f.grant('website'),paired=await f.ok('/companion/browser/pair',f.body(grant.code),f.extension);
    const replacement=await f.grant('website');
    const definition={version:'pinned',effect:'recorded_browser_actions',timeout_ms:15000,inputs:{},steps:[{op:'click',selector:'#submit'}],outputs:[{name:'receipt',selector:'#receipt'}],verifiers:[{kind:'nonempty',output:'receipt'}]};
    const at=new Date().toISOString();db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf','website','Fixture submit','fixture.submit','published','pinned',seal(definition),'pinned',at);
    const key='hm_live_'+randomBytes(32).toString('base64url');db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key','Fixture key',hash(key),'suffix','wf','2099-01-01T00:00:00.000Z',null,at);
    const auth={authorization:'Bearer '+key,'idempotency-key':'first'},transport={...f.extension,authorization:'Bearer '+paired.token},path='/v1/actions/fixture.submit/versions/1/runs';
    let issued,commandId,operations=0;const issuance=new Promise(resolve=>issued=resolve);
    const companion=(async()=>{while(true){
      const response=await f.ok('/companion/browser/poll',{},transport);if(response.type==='idle')continue;
      assert.equal(response.type,'command');
      if(response.command.op==='snapshot'){
        await f.ok('/companion/browser/reply',{id:response.id,ok:true,value:{url:f.origin+'/sandbox/',title:'Fixture',doc:{elements:[{kind:'button',selector:'#submit',label:'Submit fixture',type:'button',disabled:false}],challenge:false,denied:false,authRejected:false,networkError:false,login:false,credentials:false,textLength:20,readyState:'complete'}}},transport);
      }else{
        assert.equal(response.command.op,'operate');commandId=response.id;
        assert.equal((await f.ok('/companion/browser/authorize',{id:commandId},transport)).authorized,true);
        operations++;issued();return; // Deliberately lose the acknowledgement after issue.
      }
    }})();
    const first=await f.ok(path,{input:{}},auth);await issuance;await companion;
    const second=await f.ok(path,{input:{}},{...auth,'idempotency-key':'second'});
    assert.equal((await f.call('/companion/browser/pair',f.body(replacement.code),f.extension)).value.error.code,'BROWSER_BUSY');
    await until(()=>run(first.run_id).status==='failed',18000);
    assert.equal(run(first.run_id).error.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(run(first.run_id).error.cause_code,'TIMEOUT');
    assert.equal(run(first.run_id).steps[0].status,'failed');assert.equal(run(first.run_id).error.retry_safe,false);
    await until(()=>run(second.run_id).status==='failed');assert.equal(run(second.run_id).error.code,'BROWSER_DISCONNECTED','unstarted sibling is unavailable, not cancelled or replayed');
    assert.equal(run(second.run_id).submission_may_have_occurred,undefined);assert.equal(operations,1);
    assert.equal((await f.call('/companion/browser/authorize',{id:commandId},transport)).status,401,'an old command cannot regain mutation permission');
    assert.equal((await f.call('/companion/browser/reply',{id:commandId,ok:true,value:true},transport)).status,401,'late completion cannot overwrite the terminal result');
    assert.equal(run(first.run_id).status,'failed');assert.equal(run(first.run_id).result,undefined);
  }finally{await f.app.close();}
});

test('shutdown flushes a real long poll and prevents queued dispatch before HTTP drain',{timeout:10000},async()=>{
  let executions=0;const f=await fixture(4417,async()=>{},{execute:async()=>{executions++;return {result:{value:'fixture'},verification:{checks:[]}};}}),{db,seal}=f.store;
  try{
    f.seed('website');const grant=await f.grant('website'),paired=await f.ok('/companion/browser/pair',f.body(grant.code),f.extension),transport={...f.extension,authorization:'Bearer '+paired.token,'content-type':'application/json'};
    await f.app.listen({port:4417,host:'127.0.0.1'});
    await fetch(f.origin+'/companion/browser/poll',{method:'POST',headers:transport,body:'{}'}); // Drain the initial idle acknowledgement.
    const poll=fetch(f.origin+'/companion/browser/poll',{method:'POST',headers:transport,body:'{}'}).then(response=>response.json());await pause(30);
    const at=new Date().toISOString(),definition={version:'fixture',effect:'retrieval',inputs:{},steps:[],outputs:[{name:'value',selector:'#value'}],verifiers:[{kind:'nonempty',output:'value'}]};
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('isolated','Queued fixture','https://fixture.test/','connected',seal({url:'https://fixture.test/',origins:['https://fixture.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://fixture.test'}}),at);
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_shutdown','isolated','Queued fixture','fixture.shutdown','published','fixture',seal(definition),'fixture',at);
    const key='hm_live_'+randomBytes(32).toString('base64url');db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_shutdown','Shutdown fixture',hash(key),'suffix','wf_shutdown','2099-01-01T00:00:00.000Z',null,at);
    const receipt=await f.ok('/v1/actions/fixture.shutdown/versions/1/runs',{input:{}},{authorization:'Bearer '+key,'idempotency-key':'shutdown'}),started=Date.now();
    await f.app.close();assert.ok(Date.now()-started<5000,'shutdown does not wait for the eighteen-second poll timeout');
    assert.equal((await poll).type,'closed');assert.equal(executions,0,'HTTP drain must not dispatch new browser work');
    const reopened=openStore(f.dataDir);try{assert.equal(reopened.db.prepare('SELECT status FROM runs WHERE id=?').get(receipt.run_id).status,'queued','unstarted durable work is preserved for restart authorization checks');}finally{reopened.close();}
  }finally{await f.app.close();}
});
