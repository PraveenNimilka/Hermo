import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {id,hash} from '../server/store.mjs';

test('owner resource deletion requires typed names, preserves neighboring data and prevents active-run races',{timeout:30000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  let release,started=false;
  const engine={isOpen:()=>false,close:async()=>{},closeStudios:async()=>{},closeAll:async()=>{},execute:async()=>{started=true;return new Promise(done=>{release=()=>done({result:{temperature:'24'},verification:{checks:['fixture']}});});}};
  const port=4399,{app,store,enqueue,workflow}=await createApp({port,dataDir:resolve('work/resource-removal-tests',randomBytes(6).toString('hex')),browserEngineFactory:async()=>engine});
  const {db,seal,unseal}=store;
  let cookie='',csrf='';
  const call=async(url,payload,extra={})=>{
    const response=await app.inject({method:payload===undefined?'GET':'POST',url,headers:{host:`127.0.0.1:${port}`,cookie,...payload===undefined?{}:{'x-hermo-csrf':csrf},...extra},...payload===undefined?{}:{payload}});
    const set=response.headers['set-cookie'];if(set)cookie=(Array.isArray(set)?set[0]:set).split(';')[0];
    return response;
  };
  const ok=async(url,payload)=>{const r=await call(url,payload);assert.ok(r.statusCode<300,`${url}: ${r.statusCode} ${r.body}`);return r.json();};
  const stamp=()=>new Date().toISOString();
  const cid=id('connection');
  const seedAction=(name='Weather')=>{
    const wid=id('workflow'),definition={version:'fixture-version',inputs:{},outputs:[{name:'temperature',selector:'#temperature'}],steps:[],verifiers:[{output:'temperature',type:'number'}],action_type:'read',effect:'retrieval'};
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,name,wid,'published',definition.version,seal(definition),definition.version,stamp());return wid;
  };
  const seedKey=(wid,name='Weather client',revoked=false)=>{
    const kid=id('key'),secret='hm_live_'+randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run(kid,name,hash(secret),secret.slice(-6),wid,new Date(Date.now()+86400000).toISOString(),revoked?stamp():null,stamp());return {id:kid,secret,name};
  };
  const seedRun=(wid,consumer,status='succeeded')=>{
    const rid=id('run');db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(rid,wid,consumer,'fixture-'+rid,hash('[]'),status,seal({input:{},result:{temperature:'24'},workflow_version:'fixture-version',privateFixture:'do not leak'}),stamp(),stamp());return rid;
  };
  const phrase=name=>({confirmation:`Delete "${name}"`});
  try{
    await t.test('deletion inherits owner, CSRF and origin protections',async()=>{
      assert.equal((await call('/studio/workflows/missing/remove',phrase('Weather'))).statusCode,401);
      csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-resource-removal-owner'})).csrf;
      db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Saved weather','https://weather.example.test/','connected',seal({origins:['https://weather.example.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://weather.example.test'}}),stamp());
      const wid=seedAction();
      assert.equal((await call(`/studio/workflows/${wid}/remove`,phrase('Weather'),{'x-hermo-csrf':'bad'})).statusCode,403);
      assert.equal((await call(`/studio/workflows/${wid}/remove`,phrase('Weather'),{origin:'https://attacker.example'})).statusCode,403);
      assert.equal((await call(`/studio/workflows/${wid}/remove`,{})).json().error.code,'CONFIRMATION_REQUIRED');
      assert.equal((await call(`/studio/workflows/${wid}/remove`,{...phrase('Weather'),authorized:true})).json().error.code,'CONFIRMATION_REQUIRED');
      for(const confirmation of ['Delete Weather','delete "Weather"','Delete "weather"','Delete "Weather" '])assert.equal((await call(`/studio/workflows/${wid}/remove`,{confirmation})).json().error.code,'CONFIRMATION_MISMATCH');
      assert.ok(db.prepare('SELECT id FROM workflows WHERE id=?').get(wid));
    });

    await t.test('workflow deletion cascades only its resources and keeps saved connection',async()=>{
      const name='Weather "Home"',wid=seedAction(name),key=seedKey(wid),run=seedRun(wid,key.id),neighbor=seedAction('Other weather'),otherKey=seedKey(neighbor),otherRun=seedRun(neighbor,otherKey.id);
      db.prepare('UPDATE workflows SET name=? WHERE id=?').run('Renamed weather',wid);
      assert.equal((await call(`/studio/workflows/${wid}/remove`,phrase(name))).json().error.code,'CONFIRMATION_MISMATCH');
      await ok(`/studio/workflows/${wid}/remove`,phrase('Renamed weather'));
      for(const [table,resource]of [['workflows',wid],['api_keys',key.id],['runs',run]])assert.equal(db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(resource),undefined);
      for(const [table,resource]of [['connections',cid],['workflows',neighbor],['api_keys',otherKey.id],['runs',otherRun]])assert.ok(db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(resource));
      assert.equal((await call(`/studio/workflows/${wid}/remove`,phrase('Renamed weather'))).statusCode,404);
      assert.equal((await app.inject({method:'GET',url:'/v1/action-contract',headers:{host:`127.0.0.1:${port}`,authorization:'Bearer '+key.secret}})).statusCode,401);
      assert.ok(db.prepare("SELECT id FROM audit WHERE event='action.removed' AND resource_id=?").get(wid));
    });

    await t.test('durable active runs block workflow and key deletion',async()=>{
      const wid=seedAction('Busy weather'),key=seedKey(wid),rid=seedRun(wid,key.id,'verifying');
      assert.equal((await call(`/studio/workflows/${wid}/remove`,phrase('Busy weather'))).json().error.code,'ACTION_BUSY');
      assert.equal((await call(`/studio/keys/${key.id}/remove`,phrase(key.name))).json().error.code,'KEY_BUSY');
      assert.ok(db.prepare('SELECT id FROM workflows WHERE id=?').get(wid));assert.ok(db.prepare('SELECT id FROM api_keys WHERE id=?').get(key.id));
      db.prepare("UPDATE runs SET status='cancelled' WHERE id=?").run(rid);
      await ok(`/studio/workflows/${wid}/remove`,phrase('Busy weather'));
    });

    await t.test('workflow deletion rolls back dependent records if SQLite rejects deletion',async()=>{
      const wid=seedAction('Rollback weather'),key=seedKey(wid),rid=seedRun(wid,key.id);
      db.exec("CREATE TRIGGER fixture_removal_abort BEFORE DELETE ON workflows WHEN old.name='Rollback weather' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
      try{
        const result=await call(`/studio/workflows/${wid}/remove`,phrase('Rollback weather'));
        assert.equal(result.statusCode,500);assert.equal(result.body.includes('fixture rejection'),false);
        for(const [table,resource]of [['workflows',wid],['api_keys',key.id],['runs',rid]])assert.ok(db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(resource));
        assert.equal(db.prepare("SELECT id FROM audit WHERE event='action.removed' AND resource_id=?").get(wid),undefined);
      }finally{db.exec('DROP TRIGGER fixture_removal_abort');}
      await ok(`/studio/workflows/${wid}/remove`,phrase('Rollback weather'));
    });

    await t.test('key deletion revokes authorization but keeps completed history and action',async()=>{
      const wid=seedAction('History weather'),key=seedKey(wid),rid=seedRun(wid,key.id),neighbor=seedKey(wid,'Other client',true);
      assert.equal((await call(`/studio/keys/${key.id}/remove`,phrase('Other client'))).json().error.code,'CONFIRMATION_MISMATCH');
      await ok(`/studio/keys/${key.id}/remove`,phrase(key.name));
      assert.equal(db.prepare('SELECT id FROM api_keys WHERE id=?').get(key.id),undefined);assert.ok(db.prepare('SELECT id FROM workflows WHERE id=?').get(wid));assert.ok(db.prepare('SELECT id FROM api_keys WHERE id=?').get(neighbor.id));
      const retained=db.prepare('SELECT * FROM runs WHERE id=?').get(rid);assert.equal(retained.consumer_id,key.id);assert.equal(retained.idem,'fixture-'+rid);assert.equal(retained.request_hash,hash('[]'));assert.equal(retained.status,'succeeded');assert.equal(unseal(retained.payload).result.temperature,'24');
      assert.equal((await app.inject({method:'GET',url:'/v1/runs/'+rid,headers:{host:`127.0.0.1:${port}`,authorization:'Bearer '+key.secret}})).statusCode,401);
      assert.equal((await call(`/studio/keys/${key.id}/remove`,phrase(key.name))).statusCode,404);
      await ok(`/studio/keys/${neighbor.id}/remove`,phrase(neighbor.name));
      assert.ok(db.prepare("SELECT id FROM audit WHERE event='key.removed' AND resource_id=?").get(key.id));
    });

    await t.test('cancelled execution still unwinding blocks deletion until worker releases it',async()=>{
      const wid=seedAction('Unwinding weather'),key=seedKey(wid),receipt=enqueue(workflow(wid),{},key.id,'in-flight');
      for(let i=0;!started&&i<100;i++)await new Promise(done=>setTimeout(done,10));assert.equal(started,true);
      await ok(`/studio/runs/${receipt.run_id}/cancel`,{});
      assert.equal(db.prepare('SELECT status FROM runs WHERE id=?').get(receipt.run_id).status,'cancelled');
      assert.equal((await call(`/studio/workflows/${wid}/remove`,phrase('Unwinding weather'))).json().error.code,'ACTION_BUSY');
      assert.equal((await call(`/studio/keys/${key.id}/remove`,phrase(key.name))).json().error.code,'KEY_BUSY');
      assert.equal((await call(`/studio/connections/${cid}/remove`,{authorized:true,confirmation:'Delete \"Saved weather\"'})).json().error.code,'CONNECTION_BUSY');
      release();release=undefined;await new Promise(done=>setTimeout(done,30));
      await ok(`/studio/workflows/${wid}/remove`,phrase('Unwinding weather'));
    });
  }finally{release?.();await app.close();}
});
