import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {syncBuiltinESMExports} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {executionConnection,snapshotConnection} from '../server/workflow-revisions.mjs';

// Controlled adapter/DNS interleavings exercise owner state serialization, not
// website authentication or real network compatibility.
test('reset revokes stale owner operations and old frozen session authority',{timeout:15000},async()=>{
  const previousMaster=process.env.HERMO_MASTER_KEY,originalLookup=dns.lookup;
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reserved=createServer();await new Promise(done=>reserved.listen(0,'127.0.0.1',done));
  const port=reserved.address().port;await new Promise(done=>reserved.close(done));
  let state,cookie='',csrf='',heldSnapshot,notifySnapshot,holdSnapshot=false,releaseDns,notifyDns;
  const open=new Set(),secret='controlled-old-session-cookie';
  const identity='Fixture Account Owner';
  const engine={
    open:async cid=>{open.add(cid);},close:async cid=>{open.delete(cid);},isOpen:cid=>open.has(cid),isProfileBusy:()=>false,
    snapshot:async()=>{if(holdSnapshot){notifySnapshot();await new Promise(done=>heldSnapshot=done);}return {can_confirm:true,url:`http://127.0.0.1:${port}/sandbox/`,state:'ready'};},
    element:()=>({selector:'#identity'}),read:async()=>identity,
    save:async()=>({storageState:{cookies:[{name:'fixture',value:secret,domain:'127.0.0.1',path:'/sandbox',expires:-1,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]},checkpoint:`http://127.0.0.1:${port}/sandbox/`}),
    allowOrigins:()=>{},closeStudios:async()=>open.clear(),closeAll:async()=>open.clear()
  };
  const call=async(path,body)=>{
    const response=await fetch(state.origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf}},...body===undefined?{}:{body:JSON.stringify(body)}});
    const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];
    return {status:response.status,value:await response.json()};
  };
  const ok=async(...args)=>{const value=await call(...args);assert.ok(value.status<300,JSON.stringify(value));return value.value;};
  try{
    state=await createApp({port,dataDir:resolve('work/managed-profile-race',randomUUID()),browserEngineFactory:async()=>engine});
    await state.app.listen({host:'127.0.0.1',port});
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'controlled-session-race-owner'})).csrf;
    const c=(await ok('/studio/connections',{name:'Race fixture',url:state.origin+'/sandbox/',browser_mode:'isolated',access:'account',authorized:true})).connection;
    const base=`/studio/connections/${c.id}`,confirm=()=>ok(base+'/confirm',{element_id:'identity'});
    const saved=()=>{const row=state.store.db.prepare('SELECT * FROM connections WHERE id=?').get(c.id);return {...row,...state.store.unseal(row.payload)};};
    await ok(base+'/open',{});await confirm();const original=saved(),frozen=snapshotConnection(original);
    assert.equal(original.storageState.cookies[0].value,secret);

    const resolving=new Promise(done=>notifyDns=done);
    dns.lookup=async function(host,...args){if(host==='held.fixture.example'){notifyDns();return new Promise(done=>releaseDns=()=>done([{address:'93.184.216.34',family:4}]));}return originalLookup.call(this,host,...args);};
    syncBuiltinESMExports();
    const expanding=call(base+'/origins',{origins:['https://held.fixture.example'],authorized:true});
    await resolving;
    await ok(base+'/managed-profile/reset',{confirmation:'Reset "Race fixture"'});releaseDns();
    const denied=await expanding;assert.equal(denied.status,409);assert.equal(denied.value.error.code,'CONNECTION_CHANGED');
    const reset=saved();assert.equal(reset.status,'auth_required');assert.equal(reset.storageState,undefined);assert.equal(reset.identity,undefined);
    assert.deepEqual(reset.origins,original.origins);assert.ok(reset.session_generation);
    await ok(base+'/open',{});await confirm();
    assert.equal(saved().identity.text,identity);
    assert.throws(()=>executionConnection(saved(),{connection_config:frozen}),{message:'REVISION_PERMISSION_CHANGED'},'the same account cannot resurrect a pre-reset immutable session binding');

    const oldGeneration=saved().session_generation;
    const observing=new Promise(done=>notifySnapshot=done);holdSnapshot=true;
    const staleConfirm=call(base+'/confirm',{element_id:'identity'});await observing;
    await ok(base+'/managed-profile/reset',{confirmation:'Reset "Race fixture"'});heldSnapshot();
    const result=await staleConfirm;assert.equal(result.status,409);assert.equal(result.value.error.code,'CONNECTION_CHANGED');
    const latest=saved();assert.notEqual(latest.session_generation,oldGeneration);assert.equal(latest.status,'auth_required');assert.equal(latest.identity,undefined);assert.equal(latest.storageState,undefined);
    assert.equal(JSON.stringify(await ok(base+'/managed-profile')).includes(secret),false);
  }finally{
    releaseDns?.();heldSnapshot?.();dns.lookup=originalLookup;syncBuiltinESMExports();await state?.app.close();
    if(previousMaster===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMaster;
  }
});
