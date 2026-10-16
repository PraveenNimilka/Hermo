import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {createApp} from '../server/index.mjs';
import {publicApps} from '../server/public-examples.mjs';

process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
const {app,origin,store}=await createApp({port:4336,dataDir:resolve('work/public-tests',randomBytes(6).toString('hex'))});await app.listen({port:4336,host:'127.0.0.1'});
let cookie='',csrf='';const evidence={tested_at:new Date().toISOString(),sources:[],checks:[],google_live_sign_in:'Not tested: requires user-owned OAuth client and consent'};
const call=async(path,body,extra={})=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...extra},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,value:await r.json()};};
const ok=async(path,body,extra)=>{const r=await call(path,body,extra);assert.ok(r.status<300,JSON.stringify({path,...r}));return r.value;};
const run=async(id,reference)=>{const receipt=await ok(`/studio/public-examples/${id}/run`,{reference});for(let i=0;i<55;i++){const value=await ok(`/studio/public-examples/${id}/runs/${receipt.run_id}`);if(['succeeded','failed','cancelled'].includes(value.status))return value;await new Promise(r=>setTimeout(r,1000));}throw new Error('Live run timed out');};
try{
  assert.equal((await call('/studio/public-examples')).status,401);csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-live-public-test-password'})).csrf;
  assert.equal((await call('/studio/public-examples/setup',{authorized:true},{'x-hermo-csrf':'bad'})).status,403);
  await ok('/studio/public-examples/setup',{authorized:true});let built;
  for(let i=0;i<400;i++){built=await ok('/studio/public-examples');if(built.status==='ready')break;if(built.status==='failed')throw new Error(JSON.stringify(built));if(i%10===0)console.log(built.stage);await new Promise(r=>setTimeout(r,500));}
  assert.equal(built.status,'ready');assert.equal(built.apps.length,2);assert.equal(JSON.stringify(built).includes('hm_live_'),false);
  const catalog=store.unseal(store.getSetting('public_example_catalog'));assert.equal(store.getSetting('public_example_catalog').includes(catalog[0].key),false);
  for(const spec of publicApps){const source={website:spec.url,runs:[]};for(const [index,reference]of spec.samples.entries()){const value=await run(spec.id,reference);assert.equal(value.status,'succeeded',JSON.stringify(value));assert.equal(value.result[spec.parameter],reference);for(const field of spec.fields)assert.equal(value.result[field.name],field.values[index]);assert.ok(value.verification.checks.includes('public_source_origin'));source.runs.push({input:reference,result:value.result,verification:value.verification,duration_ms:value.duration_ms});console.log(spec.name+' verified: '+reference);}
    const missing=await run(spec.id,'UNKNOWN-RECORD');assert.equal(missing.status,'failed');assert.equal(missing.result,undefined);source.missing_record={status:missing.status,error:missing.error.code};evidence.sources.push(source);
    const item=catalog.find(c=>c.id===spec.id),payload=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(item.connection_id).payload);assert.deepEqual(payload.storageState,{cookies:[],origins:[]});
    const openapi=await ok(`/studio/workflows/${item.workflow_id}/openapi`);assert.equal(openapi.paths[`/v1/actions/${item.slug}/versions/1/runs`].post.requestBody.content['application/json'].schema.properties.input.properties[spec.parameter].pattern,'^[A-Za-z0-9_-]{1,120}$');
    assert.equal((await call(`/v1/actions/${item.slug}/versions/1/runs`,{input:{[spec.parameter]:'../private'}},{authorization:'Bearer '+item.key,'idempotency-key':'bad-path'})).status,400);
    const other=catalog.find(c=>c.id!==spec.id);assert.equal((await call(`/studio/public-examples/${other.id}/runs/${source.runs[0].id??missing.id}`)).status,404);
  }
  assert.equal((await call(`/v1/actions/${catalog[1].slug}/versions/1/runs`,{input:{author:'Albert-Einstein'}},{authorization:'Bearer '+catalog[0].key,'idempotency-key':'cross-scope'})).status,403);
  await ok(`/studio/keys/${catalog[0].key_id}/revoke`,{});assert.equal((await call(`/v1/actions/${catalog[0].slug}/versions/1/runs`,{input:{book:publicApps[0].samples[0]}},{authorization:'Bearer '+catalog[0].key,'idempotency-key':'revoked'})).status,401);
  evidence.checks=['actual external browser reads','second record changes output','missing record fails without result','anonymous cookie-free replay','encrypted demo key catalog','keys absent from UI payload','path traversal rejected','cross-action key rejected','cross-key run isolation','revoked key rejected','OpenAPI parameter pattern'];
  writeFileSync(resolve('PUBLIC-INTEGRATION-VALIDATION.json'),JSON.stringify(evidence,null,2));console.log('Live website verification passed. No secrets in the saved report.');
}finally{await app.close();}
