import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync,readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { openStore,passwordHash,passwordMatches } from '../server/store.mjs';
test('credentials use slow salted hashes; payloads use authenticated encryption',async()=>{
  const encoded=await passwordHash('synthetic-test-password');
  assert.equal(await passwordMatches('synthetic-test-password',encoded),true);
  assert.equal(await passwordMatches('incorrect-password',encoded),false);
  assert.notEqual(encoded,await passwordHash('synthetic-test-password'));
  const folder=resolve('work/hermo-security-tests',randomBytes(6).toString('hex'));
  mkdirSync(folder,{recursive:true});process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const store=openStore(folder);
  try {
    const sensitive={cookie:'PRIVATE_SESSION_MARKER_2026',input:'private-customer-reference'},encrypted=store.seal(sensitive);
    assert.equal(encrypted.includes(sensitive.cookie),false);assert.deepEqual(store.unseal(encrypted),sensitive);
    const tampered=Buffer.from(encrypted,'base64');tampered[tampered.length-1]^=1;
    assert.throws(()=>store.unseal(tampered.toString('base64')));
    store.setSetting('encrypted_fixture',encrypted);
  }finally{store.close();}
  assert.equal(readFileSync(join(folder,'hermo.sqlite')).includes(Buffer.from('PRIVATE_SESSION_MARKER_2026')),false);
  const reopened=openStore(folder);
  try{assert.equal(reopened.unseal(reopened.getSetting('encrypted_fixture')).cookie,'PRIVATE_SESSION_MARKER_2026');}finally{reopened.close();}
});

test('Windows DPAPI-protected key survives a store restart',{skip:process.platform!=='win32'},()=>{
  const previous=process.env.HERMO_MASTER_KEY;delete process.env.HERMO_MASTER_KEY;
  const folder=resolve('work/hermo-security-tests',randomBytes(6).toString('hex'));
  try{const first=openStore(folder);first.setSetting('fixture',first.seal({value:'dpapi-test-only'}));first.close();const next=openStore(folder);try{assert.equal(next.unseal(next.getSetting('fixture')).value,'dpapi-test-only');assert.ok(readFileSync(join(folder,'master.dpapi')).length>32);}finally{next.close();}}
  finally{if(previous)process.env.HERMO_MASTER_KEY=previous;}
});

test('one runtime owns each data directory and close cannot release a subsequent owner',()=>{
  const previous=process.env.HERMO_MASTER_KEY,key=randomBytes(32).toString('base64');
  process.env.HERMO_MASTER_KEY=key;
  const folder=resolve('work/hermo-security-tests',randomBytes(6).toString('hex'));
  let first,next,other;
  try{
    first=openStore(folder);first.setSetting('fixture',first.seal({value:'private-owner-fixture'}));
    assert.throws(()=>openStore(folder),{code:'RUNTIME_ALREADY_RUNNING'});
    process.env.HERMO_MASTER_KEY='invalid';
    assert.throws(()=>openStore(folder),{code:'RUNTIME_ALREADY_RUNNING'},'Ownership is checked before key initialization');
    process.env.HERMO_MASTER_KEY=key;
    first.close();first.close();
    next=openStore(folder);
    assert.equal(next.unseal(next.getSetting('fixture')).value,'private-owner-fixture');
    first.close();
    assert.throws(()=>openStore(folder),{code:'RUNTIME_ALREADY_RUNNING'},'An old close cannot release the new handle');
    other=openStore(resolve('work/hermo-security-tests',randomBytes(6).toString('hex')));
    assert.equal(readFileSync(join(folder,'runtime-lock.sqlite')).includes(Buffer.from('private-owner-fixture')),false);
  }finally{
    other?.close();next?.close();first?.close();
    if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;
  }
});

test('failed store initialization releases directory ownership',()=>{
  const previous=process.env.HERMO_MASTER_KEY,folder=resolve('work/hermo-security-tests',randomBytes(6).toString('hex'));
  try{
    process.env.HERMO_MASTER_KEY='invalid';
    assert.throws(()=>openStore(folder),/HERMO_MASTER_KEY must encode exactly 32 bytes/);
    process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
    const store=openStore(folder);
    try{store.setSetting('after_failure','saved');assert.equal(store.getSetting('after_failure'),'saved');}finally{store.close();}
  }finally{if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});

test('cross-process runtime lock rejects another process and recovers automatically after abrupt exit',{timeout:20000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY,key=randomBytes(32).toString('base64');
  process.env.HERMO_MASTER_KEY=key;
  const folder=resolve('work/hermo-security-tests',randomBytes(6).toString('hex'));
  const moduleURL=new URL('../server/store.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import {openStore} from ${JSON.stringify(moduleURL)};
    const store=openStore(process.argv[1]);
    store.setSetting('persisted',store.seal({value:'survives-abrupt-exit'}));
    process.send('ready');
    process.on('message',()=>process.exit(17));
    process.on('disconnect',()=>process.exit(18));
    setTimeout(()=>process.exit(19),12000).unref();
  `,folder],{env:{...process.env,HERMO_MASTER_KEY:key},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
  let childError='';child.stderr.on('data',data=>{childError+=data;});
  try{
    const ready=await Promise.race([once(child,'message'),once(child,'exit').then(([code])=>{throw Error(`Fixture runtime exited before readiness (${code}): ${childError}`);})]);
    assert.equal(ready[0],'ready');
    assert.throws(()=>openStore(folder),{code:'RUNTIME_ALREADY_RUNNING'});
    const contender=spawnSync(process.execPath,['--input-type=module','-e',`
      import {openStore} from ${JSON.stringify(moduleURL)};
      try{const store=openStore(process.argv[1]);store.close();process.exitCode=1;}
      catch(error){if(error.code!=='RUNTIME_ALREADY_RUNNING')throw error;process.stdout.write(error.code);}
    `,folder],{env:{...process.env,HERMO_MASTER_KEY:key},encoding:'utf8',timeout:5000,windowsHide:true});
    assert.equal(contender.status,0,contender.stderr||String(contender.error));
    assert.equal(contender.stdout,'RUNTIME_ALREADY_RUNNING');
    const exited=once(child,'exit');child.send('exit-without-store-close');
    assert.equal((await exited)[0],17);
    const recovered=openStore(folder);
    try{
      assert.equal(recovered.unseal(recovered.getSetting('persisted')).value,'survives-abrupt-exit');
      assert.throws(()=>openStore(folder),{code:'RUNTIME_ALREADY_RUNNING'});
    }finally{recovered.close();}
    const restarted=openStore(folder);restarted.close();
  }finally{
    if(child.connected)child.disconnect();
    if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;
  }
});
