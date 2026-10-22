import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserIdentity} from '../companion/browser/browser-identity.mjs';

test('concurrent tab connections share one persisted browser identity',async()=>{
  let value,reads=0,writes=0,generated=0;
  const storage={get:async()=>{reads++;await new Promise(done=>setTimeout(done,10));return {browserContext:value};},set:async data=>{writes++;await new Promise(done=>setTimeout(done,10));value=data.browserContext;}};
  const identity=createBrowserIdentity(storage,()=>{generated++;return 'a'.repeat(36);});
  const contexts=await Promise.all(Array.from({length:20},()=>identity()));
  assert.equal(new Set(contexts).size,1);assert.equal(value,contexts[0]);assert.equal(reads,1);assert.equal(writes,1);assert.equal(generated,1);
  assert.equal(await createBrowserIdentity(storage)(),value,'worker reload retains the stored profile identity');assert.equal(writes,1);
});

test('storage failures cannot return an unpersisted browser identity and can be retried',async()=>{
  let fail=true,value;
  const identity=createBrowserIdentity({get:async()=>({browserContext:value}),set:async data=>{if(fail)throw Error('STORAGE_FAILED');value=data.browserContext;}},()=> 'b'.repeat(36));
  await assert.rejects(identity(),/STORAGE_FAILED/);fail=false;assert.equal(await identity(),value);assert.equal(value,'bc_'+'b'.repeat(36));
});

test('different Chrome profiles retain separate identities',async()=>{
  const a='bc_'+'a'.repeat(36),b='bc_'+'b'.repeat(36);
  const profile=value=>createBrowserIdentity({get:async()=>({browserContext:value}),set:async()=>assert.fail('valid identities must not be replaced')});
  assert.equal(await profile(a)(),a);assert.equal(await profile(b)(),b);assert.notEqual(a,b);
});
