import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {readdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {openStore} from '../server/store.mjs';
import {createBrowserEngine} from '../server/browser.mjs';

test('shutdown waits for a pending persistent launch and never brings the late profile online',{timeout:30000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/persistent-startup',randomBytes(8).toString('hex')),store=openStore(dataDir);
  let release,entered,online=0,grants=0,engine;
  const gate=new Promise(done=>release=done),starting=new Promise(done=>entered=done);
  const proxy={url:'http://127.0.0.1:1',register:()=>{grants++;return {username:'synthetic',password:'synthetic',release:()=>grants--};}};
  try{
    engine=await createBrowserEngine(proxy,'http://127.0.0.1:1',{dataDir,store,launchPersistentContext:async(directory,options)=>{
      assert.equal(options.offline,true);entered();await gate;const context=await chromium.launchPersistentContext(directory,options),setOffline=context.setOffline.bind(context);
      context.setOffline=async value=>{if(!value)online++;return setOffline(value);};return context;
    }});
    const opening=engine.open('conn_late',{id:'conn_late',url:'https://example.com/',origins:['https://example.com'],access:'account'}),rejected=assert.rejects(opening,/BROWSER_CLOSED/);
    await starting;let closed=false;const stopping=engine.closeAll().then(()=>closed=true);
    await new Promise(done=>setImmediate(done));assert.equal(closed,false,'shutdown owns the pending context until cleanup');
    release();await rejected;await stopping;
    assert.equal(online,0);assert.equal(grants,0);assert.deepEqual(readdirSync(join(dataDir,'managed-profile-active')),[]);
    assert.equal(engine.hasDiskProfile('conn_late'),false,'a canceled launch cannot create recovery authority');
  }finally{release?.();await engine?.closeAll();store.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
