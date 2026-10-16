import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {exampleApps} from '../server/examples.mjs';

test('three owned websites generate real scoped APIs consumed by the integration lab',{timeout:240000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const {app,origin,store}=await createApp({port:4333,dataDir:resolve('work/example-tests',randomBytes(6).toString('hex'))});await app.listen({port:4333,host:'127.0.0.1'});
  let cookie='',csrf='';
  const call=async(path,body,extra={})=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...extra},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,value:await r.json()};};
  const ok=async(path,body,extra)=>{const r=await call(path,body,extra);assert.ok(r.status<300,JSON.stringify({path,...r}));return r.value;};
  const build=async()=>{await ok('/studio/examples/setup',{authorized:true});for(let i=0;i<500;i++){const state=await ok('/studio/examples');if(state.status==='ready')return state;if(state.status==='failed')assert.fail(JSON.stringify(state));await new Promise(resolve=>setTimeout(resolve,200));}assert.fail('Example build exceeded its time budget');};
  const run=async(id,reference)=>{const receipt=await ok(`/studio/examples/${id}/run`,{reference});for(let i=0;i<50;i++){const result=await ok(`/studio/examples/${id}/runs/${receipt.run_id}`);if(['succeeded','failed','cancelled'].includes(result.status))return result;await new Promise(resolve=>setTimeout(resolve,1000));}assert.fail('Example run timed out');};
  try{
    assert.equal((await call('/studio/examples')).status,401);csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-integration-lab-password'})).csrf;
    assert.equal((await call('/studio/examples/setup',{authorized:false})).status,400);assert.equal((await call('/studio/examples/setup',{authorized:true},{'x-hermo-csrf':'bad'})).status,403);
    const built=await build();assert.equal(built.apps.length,3);assert.equal(JSON.stringify(built).includes('hm_live_'),false);
    const privateCatalog=store.unseal(store.getSetting('example_catalog'));assert.equal(privateCatalog.length,3);assert.equal(store.getSetting('example_catalog').includes(privateCatalog[0].key),false);
    for(const spec of exampleApps){for(const [i,reference]of spec.samples.entries()){const result=await run(spec.id,reference);assert.equal(result.status,'succeeded');assert.equal(result.result[spec.parameter],reference);assert.equal(result.result[spec.output],spec.values[i]);assert.ok(result.verification.checks.includes('account_identity'));assert.equal((await call(`/studio/examples/${spec.id==='orders'?'shipping':'orders'}/runs/${result.id}`)).status,404);}
      const missing=await run(spec.id,'UNKNOWN-RECORD');assert.equal(missing.status,'failed');assert.equal(missing.result,undefined);
    }
    const item=privateCatalog[0],other=privateCatalog[1];assert.equal((await call(`/v1/actions/${other.slug}/versions/1/runs`,{input:{tracking_id:'PKG-4101'}},{authorization:'Bearer '+item.key,'idempotency-key':'cross-example'})).status,403);
    const oldKey=item.key;const rebuilt=await build();assert.equal(rebuilt.apps.length,3);assert.equal((await ok('/studio/overview')).workflows.length,3);assert.equal((await call(`/v1/actions/${item.slug}/versions/1/runs`,{input:{order_id:'ORD-2041'}},{authorization:'Bearer '+oldKey,'idempotency-key':'revoked-example'})).status,401);
    await ok('/studio/logout',{});assert.equal((await call('/studio/examples')).status,401);assert.equal((await call('/studio/examples/orders/run',{reference:'ORD-2041'})).status,401);
  }finally{await app.close();}
});
