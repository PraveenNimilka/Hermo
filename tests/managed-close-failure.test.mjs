import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {readdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {openStore} from '../server/store.mjs';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';

test('failed Chromium closure retains the lease and last committed archive until confirmed disconnected',{timeout:30000},async()=>{
  const prior=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/managed-close-failure',randomBytes(8).toString('hex')),store=openStore(dataDir);
  const server=createServer((req,res)=>{res.end('<!doctype html><h1>Controlled close fixture</h1>');});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin='http://127.0.0.1:'+server.address().port;let engine,proxy,realContext,realClose,profile,fail=false,connected=true,originalRows;
  const reportedBrowser=new EventEmitter();reportedBrowser.isConnected=()=>connected;reportedBrowser.close=async()=>{throw Error('Injected process close failure');};
  try{
    proxy=await createEgressProxy(origin);engine=await createBrowserEngine(proxy,origin,{store,dataDir,launchPersistentContext:async(directory,options)=>{
      profile=directory;const ctx=await chromium.launchPersistentContext(directory,options);if(fail){realContext=ctx;realClose=ctx.close.bind(ctx);ctx.close=async()=>{throw Error('Injected context close failure');};ctx.browser=()=>reportedBrowser;}return ctx;
    }});
    const connection={id:'conn_close_failure',url:origin+'/sandbox/',origins:[origin],access:'account'};
    await engine.open(connection.id,connection);writeFileSync(join(profile,'fixture'),'committed');await engine.close(connection.id);
    originalRows=store.db.prepare('SELECT * FROM managed_profile_files').all();assert.ok(originalRows.length);
    fail=true;await engine.open(connection.id,connection);writeFileSync(join(profile,'fixture'),'unflushed');
    await assert.rejects(engine.close(connection.id),/Injected context close failure/);
    assert.deepEqual(store.db.prepare('SELECT * FROM managed_profile_files').all(),originalRows,'failure never overwrites last committed snapshot');
    assert.equal(readdirSync(join(dataDir,'managed-profile-active')).length,1,'live process keeps its active directory');
    await assert.rejects(engine.open(connection.id,connection),/MANAGED_PROFILE_BUSY/,'live process keeps the connection lease');
    await realClose();realContext=undefined;connected=false;reportedBrowser.emit('disconnected');
    assert.deepEqual(readdirSync(join(dataDir,'managed-profile-active')),[]);assert.deepEqual(store.db.prepare('SELECT * FROM managed_profile_files').all(),originalRows);
    fail=false;await engine.open(connection.id,connection);await engine.close(connection.id);
  }finally{await realClose?.().catch(()=>{});connected=false;reportedBrowser.emit('disconnected');await engine?.closeAll();await proxy?.close();await new Promise(done=>server.close(done));store.close();if(prior===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=prior;}
});

test('failed cleanup of a late startup keeps its profile locked until browser disconnect',{timeout:30000},async()=>{
  const prior=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/managed-close-failure',randomBytes(8).toString('hex')),store=openStore(dataDir);
  let engine,realClose,release,entered,connected=true;
  const gate=new Promise(done=>release=done),starting=new Promise(done=>entered=done);
  const browser=new EventEmitter();browser.isConnected=()=>connected;browser.close=async()=>{throw Error('Injected startup process close failure');};
  const proxy={url:'http://127.0.0.1:1',register:()=>({username:'fixture',password:'fixture',release(){}})};
  try{
    engine=await createBrowserEngine(proxy,'http://127.0.0.1:1',{store,dataDir,launchPersistentContext:async(directory,options)=>{
      const ctx=await chromium.launchPersistentContext(directory,options);realClose=ctx.close.bind(ctx);ctx.close=async()=>{throw Error('Injected startup context close failure');};ctx.browser=()=>browser;entered();await gate;return ctx;
    }});
    const opening=engine.open('conn_failed_start',{id:'conn_failed_start',url:'https://example.com/',origins:['https://example.com'],access:'account'});
    const rejected=assert.rejects(opening,/BROWSER_CLOSED/);await starting;
    const shutdown=engine.closeAll(),busy=assert.rejects(shutdown,/MANAGED_PROFILE_BUSY/);release();await rejected;await busy;
    assert.equal(readdirSync(join(dataDir,'managed-profile-active')).length,1);
    assert.equal(engine.hasDiskProfile('conn_failed_start'),false);
    await realClose();connected=false;browser.emit('disconnected');
    assert.deepEqual(readdirSync(join(dataDir,'managed-profile-active')),[]);await engine.closeAll();
  }finally{release?.();await realClose?.().catch(()=>{});connected=false;browser.emit('disconnected');await engine?.closeAll();store.close();if(prior===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=prior;}
});
