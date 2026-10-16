import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createApp } from '../server/index.mjs';

test('end-to-end recording, publishing, REST/MCP, privacy and hostile requests', {timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4330,appState=await createApp({port,dataDir:resolve('work/hermo-workflow-tests',randomBytes(6).toString('hex'))});
  const {app,origin,store}=appState;await app.listen({port,host:'127.0.0.1'});
  let cookie='',csrf='',wf,key1,key2,connection;
  const call=async(path,body,extra={})=>{
    const headers={...cookie?{Cookie:cookie}:{},...body!==undefined?{'Content-Type':'application/json','X-Hermo-CSRF':csrf}:{},...extra};
    const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
    const set=response.headers.get('set-cookie');if(set?.startsWith(`hermo_owner_${port}=`))cookie=set.split(';')[0];
    const value=await response.json();return {status:response.status,value,headers:response.headers};
  };
  const ok=async(path,body,extra)=>{const response=await call(path,body,extra);assert.ok(response.status<300,`${path}: ${response.status} ${JSON.stringify(response.value)}`);return response.value;};
  const finish=async(rid)=>{for(let i=0;i<100;i++){const run=await ok('/studio/runs/'+rid);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(r=>setTimeout(r,200));}throw new Error('Run did not finish');};
  const raw=(path,headers={})=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path,headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});
  const snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);
  const control=(item,kind,value,recording,parameter)=>ok(`/studio/connections/${connection.id}/control`,{element_id:item.id,kind,...value!==undefined?{value}:{},...recording?{recording_id:recording}:{},...parameter?{parameter}:{}});
  try {
    await t.test('workspace setup, CSRF, host, origin and canonical route defenses',async()=>{
      assert.equal((await call('/studio/overview')).status,401);
      const session=await ok('/studio/session');csrf=session.csrf;assert.equal(session.setup_required,true);
      const auth=await ok('/studio/setup',{password:'synthetic-e2e-password-2026'});csrf=auth.csrf;
      assert.equal((await call('/studio/setup',{password:'another-test-password'})).status,409);
      assert.equal((await call('/studio/settings',{retention_days:30},{'X-Hermo-CSRF':'bad'})).status,403);
      assert.equal((await call('/studio/session',undefined,{Origin:'https://evil.example'})).status,403);
      assert.equal((await call('/studio/session',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
      assert.equal(await raw('/studio/session',{Host:'evil.example'}),403);
      for(const path of ['/%73tudio/overview','//studio/overview','/studio%2foverview','/studio/../studio/overview'])assert.equal(await raw(path),400,path);
      const response=await call('/studio/overview');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(response.headers.get('cache-control'),'no-store');
    });
    await t.test('connect and authenticate a real isolated browser without leaking its cookies',async()=>{
      assert.equal((await call('/studio/connections',{name:'Private',url:'http://169.254.169.254',authorized:true})).status,400);
      connection=(await ok('/studio/connections',{name:'Test Northstar',url:origin+'/sandbox/',authorized:true})).connection;
      await ok(`/studio/connections/${connection.id}/open`,{});
      assert.ok((await snapshot()).elements.some(x=>x.label==='Email'),'The synthetic login form must be visible through the authenticated proxy.');
      const login=await call(`/studio/connections/${connection.id}/demo-login`,{});
      if(login.status!==200){const debug=await snapshot();assert.equal(login.status,200,JSON.stringify({url:debug.url,title:debug.title,elements:debug.elements}));}
      const snap=await snapshot(),identity=snap.elements.find(x=>x.kind==='output'&&x.preview?.includes('Alex Morgan'));assert.ok(identity);
      await ok(`/studio/connections/${connection.id}/confirm`,{element_id:identity.id});
      const overview=await ok('/studio/overview');assert.equal(overview.connections[0].status,'connected');assert.equal(JSON.stringify(overview).includes('storageState'),false);
      const row=store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id);assert.equal(row.payload.includes('hermo_demo'),false);
    });
    await t.test('record parameterized browser steps and deterministic result checks',async()=>{
      const recording=await ok('/studio/recordings',{connection_id:connection.id,name:'Order lookup',slug:'orders.lookup'});
      let snap=await snapshot();const input=snap.elements.find(x=>x.kind==='input'&&x.label==='Order ID');assert.ok(input);
      const disabled=snap.elements.find(x=>x.disabled);assert.ok(disabled);
      assert.equal((await call(`/studio/connections/${connection.id}/control`,{element_id:disabled.id,kind:'click',recording_id:recording.id})).status,422);
      await control(input,'fill','ORD-2041',recording.id,'order_id');snap=await snapshot();
      await control(snap.elements.find(x=>x.kind==='button'&&x.label==='Search orders'),'click',undefined,recording.id);
      snap=await snapshot();const order=snap.elements.find(x=>x.kind==='output'&&x.preview==='ORD-2041'),status=snap.elements.find(x=>x.kind==='output'&&x.preview==='Shipped');assert.ok(order&&status);
      await ok(`/studio/recordings/${recording.id}/output`,{element_id:order.id,name:'order_id'});
      await ok(`/studio/recordings/${recording.id}/output`,{element_id:status.id,name:'status'});
      wf=(await ok(`/studio/recordings/${recording.id}/finish`,{verifiers:[{output:'order_id',input:'order_id'}]})).workflow;
      assert.equal(wf.tested,false);assert.equal((await call(`/studio/workflows/${wf.id}/publish`,{})).status,409);
    });
    await t.test('test two inputs, reject missing results and publish only verified work',async()=>{
      for(const [order,status]of [['ORD-2041','Shipped'],['ORD-2042','Processing']]){
        const receipt=await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:order}}),run=await finish(receipt.run_id);
        assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.result.order_id,order);assert.equal(run.result.status,status);assert.ok(run.verification.checks.includes('order_id_matches_order_id'));
      }
      const missing=await finish((await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:'MISSING'}})).run_id);assert.equal(missing.status,'failed');assert.equal(missing.result,undefined);
      key1=await ok(`/studio/workflows/${wf.id}/publish`,{});assert.match(key1.key,/^hm_live_/);
      key2=await ok('/studio/keys',{workflow_id:wf.id,name:'Other client'});
      assert.equal((await ok(`/studio/workflows/${wf.id}/openapi`)).openapi,'3.1.1');
      assert.equal(JSON.stringify(await ok('/studio/overview')).includes(key1.key),false);
    });
    let apiRun;
    await t.test('REST authorization, exact inputs, idempotency and cross-key isolation',async()=>{
      const path='/v1/actions/orders.lookup/versions/1/runs',headers={Authorization:'Bearer '+key1.key,'Idempotency-Key':'same-request'};
      assert.equal((await call(path,{input:{order_id:'ORD-2043'}})).status,401);
      assert.equal((await call('/v1/actions/other.action/versions/1/runs',{input:{order_id:'ORD-2043'}},headers)).status,403);
      assert.equal((await call(path,{input:{order_id:'ORD-2043',url:'https://evil.example'}},headers)).status,400);
      assert.equal((await call(path,{connection_id:'other',input:{order_id:'ORD-2043'}},headers)).status,403);
      apiRun=await ok(path,{input:{order_id:'ORD-2043'}},headers);
      const retry=await ok(path,{input:{order_id:'ORD-2043'}},headers);assert.equal(retry.run_id,apiRun.run_id);assert.equal(retry.reused,true);
      assert.equal((await call(path,{input:{order_id:'ORD-2042'}},headers)).status,409);
      const run=await finish(apiRun.run_id);assert.equal(run.status,'succeeded');assert.equal(run.result.order_id,'ORD-2043');
      const fetched=await ok('/v1/runs/'+apiRun.run_id,undefined,{Authorization:'Bearer '+key1.key});assert.equal(fetched.input,undefined);
      assert.equal((await call('/v1/runs/'+apiRun.run_id,undefined,{Authorization:'Bearer '+key2.key})).status,404);
      assert.equal((await call('/v1/runs/'+apiRun.run_id+'/cancel',{}, {Authorization:'Bearer '+key2.key})).status,404);
    });
    await t.test('MCP discover/call/status uses the same consumer scope',async()=>{
      const headers={Authorization:'Bearer '+key1.key,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'};
      const init=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}},headers);assert.equal(init.result.serverInfo.name,'hermo');
      const list=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},headers);assert.ok(list.result.tools.some(x=>x.name==='action_orders_lookup'));
      const called=await ok('/mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'action_orders_lookup',arguments:{input:{order_id:'ORD-2041'},request_id:'mcp-test'}}},headers);assert.equal(called.result.isError,undefined,JSON.stringify(called));
      const receipt=called.result.structuredContent;assert.ok(receipt.run_id);await finish(receipt.run_id);
      const status=await ok('/mcp',{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'get_run',arguments:{run_id:receipt.run_id}}},headers);assert.equal(status.result.structuredContent.status,'succeeded');
      const denied=await ok('/mcp',{jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'get_run',arguments:{run_id:receipt.run_id}}},{...headers,Authorization:'Bearer '+key2.key});assert.equal(denied.result.isError,true);
    });
    await t.test('paused admission and durable queued cancellation',async()=>{
      await ok(`/studio/workflows/${wf.id}/pause`,{});
      const path='/v1/actions/orders.lookup/versions/1/runs',headers={Authorization:'Bearer '+key2.key,'Idempotency-Key':'paused-test'};
      assert.equal((await call(path,{input:{order_id:'ORD-2041'}},headers)).status,409);
      await ok(`/studio/workflows/${wf.id}/publish`,{});
      const receipt=appState.enqueue(appState.workflow(wf.id),{order_id:'ORD-2041'},key2.id,'cancel-before-dispatch');
      const cancelled=await ok('/v1/runs/'+receipt.run_id+'/cancel',{},headers);assert.equal(cancelled.status,'cancelled');
      assert.equal((await finish(receipt.run_id)).result,undefined);
    });
    await t.test('wrong-record verification never returns success',async()=>{
      const row=store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(wf.id),definition=store.unseal(row.payload);
      const altered=structuredClone(definition);altered.outputs.find(x=>x.name==='order_id').selector='[data-testid="order-status"]';
      store.db.prepare('UPDATE workflows SET payload=? WHERE id=?').run(store.seal(altered),wf.id);
      const run=await finish((await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:'ORD-2041'}})).run_id);
      assert.equal(run.status,'failed');assert.equal(run.error.code,'VERIFICATION_FAILED');assert.equal(run.result,undefined);
      store.db.prepare('UPDATE workflows SET payload=? WHERE id=?').run(row.payload,wf.id);
    });
    await t.test('expired sessions, reconnection, revocation and encrypted data export',async()=>{
      appState.sandbox.expireAll();const run=await finish((await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:'ORD-2041'}})).run_id);assert.equal(run.error.code,'AUTH_REQUIRED');
      const overview=await ok('/studio/overview');assert.equal(overview.connections[0].status,'expired');
      await ok(`/studio/connections/${connection.id}/open`,{});await ok(`/studio/connections/${connection.id}/demo-login`,{});
      const marker=(await snapshot()).elements.find(x=>x.preview?.includes('Alex Morgan'));assert.ok(marker);
      await ok(`/studio/connections/${connection.id}/confirm`,{element_id:marker.id});
      assert.equal((await finish((await ok(`/studio/workflows/${wf.id}/test`,{input:{order_id:'ORD-2041'}})).run_id)).status,'succeeded');
      await ok('/studio/keys/'+key1.id+'/revoke',{});assert.equal((await call('/v1/runs/'+apiRun.run_id,undefined,{Authorization:'Bearer '+key1.key})).status,401);
      const exported=await ok('/studio/privacy-export');assert.equal(JSON.stringify(exported).includes('storageState'),false);assert.equal(JSON.stringify(exported).includes(key2.key),false);
      await ok(`/studio/connections/${connection.id}/disconnect`,{});assert.equal((await call('/v1/runs/'+apiRun.run_id,undefined,{Authorization:'Bearer '+key2.key})).status,401);
      const payload=store.unseal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id).payload);assert.equal(payload.storageState,undefined);
      await ok('/studio/logout',{});assert.equal((await call('/studio/overview')).status,401);
    });
  } finally {await app.close();}
});
