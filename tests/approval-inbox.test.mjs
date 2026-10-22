import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {openStore} from '../server/store.mjs';
import {installApprovalInbox} from '../server/approval-inbox.mjs';

async function fixture(t){
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const directory=mkdtempSync(join(tmpdir(),'hermo-approval-inbox-')),store=openStore(directory),app=Fastify();
  if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;
  t.after(async()=>{await app.close();store.close();rmSync(directory,{recursive:true,force:true});});
  // The production installer inherits the existing /studio owner hook. This
  // stub verifies that mounting it does not create a consumer authorization path.
  app.addHook('onRequest',async(req,reply)=>{if(req.url.startsWith('/studio/')&&req.headers['x-owner']!=='yes')return reply.code(401).send({error:{code:'UNAUTHORIZED'}});});
  const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{statusCode:status,code});};
  app.setErrorHandler((error,req,reply)=>reply.code(error.statusCode??500).send({error:{code:error.code??'INTERNAL_ERROR'}}));
  installApprovalInbox(app,{store,fail});
  const at=new Date().toISOString();
  store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn','Fixture','https://example.test/','connected',store.seal({}),at);
  store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf','conn','Approval fixture','approval.fixture','published','pinned-version',store.seal({}),null,at);
  const add=(id,payload,status='failed',created=at)=>store.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(id,'wf','consumer',id,id,status,store.seal(payload),created,created);
  const get=async(query='',headers={'x-owner':'yes'})=>{const response=await app.inject({method:'GET',url:'/studio/approvals'+query,headers});return {status:response.statusCode,value:response.json()};};
  return {app,store,add,get};
}
const approval=(status='pending',offset=0)=>({id:randomUUID(),step:1,operation:'click',status,requested_at:new Date(Date.now()+offset-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),context:{workflow_name:'Pinned workflow',workflow_version:'pinned-version',website_origin:'https://example.test/task?secret=NEVER_INCLUDE',risk:'high',target:{role:'button',name:'Submit',selector:'#NEVER_INCLUDE'},value:'NEVER_INCLUDE'}});

test('owner-only pending inbox returns sanitized durable approvals without exposing run data',async t=>{
  const f=await fixture(t),pending=approval();f.add('run_pending',{workflow_version:'pinned-version',workflow_revision:3,execution_mode:'connected_chrome',phase:'awaiting_approval',approval:pending,approval_history:[pending],input:{password:'NEVER_INCLUDE'},result:{private:'NEVER_INCLUDE'},error:{message:'NEVER_INCLUDE'}},'running');
  assert.equal((await f.get('',{})).status,401);
  assert.equal((await f.get('',{authorization:'Bearer hm_live_consumer'})).status,401);
  const {status,value}=await f.get();assert.equal(status,200);assert.equal(value.items.length,1);assert.equal(value.next_cursor,null);
  const item=value.items[0];assert.equal(item.run_id,'run_pending');assert.equal(item.actionable,true);assert.equal(item.workflow_revision,3);assert.equal(item.approval.context.website_origin,'https://example.test');assert.equal(item.approval.context.risk,'high');assert.equal(item.approval.context.proposed_value_redacted,true);
  assert.doesNotMatch(JSON.stringify(value),/NEVER_INCLUDE|password|selector|"input"|"result"|"error"/);
  assert.notEqual(f.store.db.prepare('SELECT payload FROM runs').get().payload.includes('pinned-version'),true,'saved approval remains encrypted');
  assert.equal((await f.app.inject({method:'POST',url:'/studio/approvals',headers:{'x-owner':'yes'},payload:{decision:'approve'}})).statusCode,404);
  assert.equal((await f.app.inject({method:'GET',url:'/v1/approvals',headers:{authorization:'Bearer hm_live_consumer'}})).statusCode,404);
});

test('history includes decisions and expired pending requests without fabricating or persisting decisions',async t=>{
  const f=await fixture(t),now=Date.now();
  for(const [index,status]of ['approved','rejected','expired','cancelled'].entries()){
    const event={...approval(status),decided_at:new Date(now).toISOString(),actor:'workspace_owner',wait_ms:12};f.add('run_'+index,{approval:event,approval_history:[event]});
  }
  const expired={...approval(),expires_at:new Date(now-1000).toISOString()};f.add('run_expired_pending',{phase:'awaiting_approval',approval:expired},'running');
  const inactive=approval();f.add('run_inactive_pending',{phase:'failed',approval:inactive});
  assert.equal((await f.get()).value.items.length,0);
  const history=(await f.get('?view=history')).value.items;assert.equal(history.length,6);
  assert.deepEqual(new Set(history.map(item=>item.approval.status)),new Set(['approved','rejected','expired','cancelled','pending']));
  const observed=history.find(item=>item.run_id==='run_expired_pending');assert.equal(observed.expired,true);assert.equal(observed.actionable,false);assert.equal(observed.approval.status,'pending');
  assert.equal(f.store.unseal(f.store.db.prepare('SELECT payload FROM runs WHERE id=?').get('run_expired_pending').payload).approval.status,'pending','inbox reads never settle execution decisions');
  assert.equal(history.find(item=>item.run_id==='run_inactive_pending').actionable,false);
});

test('keyset pages reach approvals beyond the overview limit with bounded empty scan continuations',async t=>{
  const f=await fixture(t),base=Date.now()-1000000,old=approval('approved');
  f.add('run_old',{approval:old},'succeeded',new Date(base).toISOString());
  for(let n=0;n<300;n++)f.add('run_empty_'+String(n).padStart(4,'0'),{},'succeeded',new Date(base+1000+n).toISOString());
  const first=(await f.get('?view=history&limit=10')).value;assert.deepEqual(first.items,[]);assert.ok(first.next_cursor,'bounded scans continue rather than hiding older approval records');
  const next=(await f.get('?view=history&limit=10&cursor='+first.next_cursor)).value;assert.deepEqual(next.items.map(item=>item.run_id),['run_old']);assert.equal(next.next_cursor,null);
});

test('within-run keysets neither skip nor duplicate multiple decisions and remain stable under newer insertions',async t=>{
  const f=await fixture(t),history=Array.from({length:30},(_,index)=>approval(index%2?'approved':'rejected',index));
  f.add('run_many',{approval:history.at(-1),approval_history:history});
  const seen=[];let cursor;
  for(let page=0;page<10;page++){
    const response=(await f.get('?view=history&limit=7'+(cursor?'&cursor='+cursor:''))).value;
    seen.push(...response.items.map(item=>item.approval.id));
    if(page===0){const payload=f.store.unseal(f.store.db.prepare('SELECT payload FROM runs WHERE id=?').get('run_many').payload);payload.approval_history.push(approval('approved',10000));f.store.db.prepare('UPDATE runs SET payload=? WHERE id=?').run(f.store.seal(payload),'run_many');}
    cursor=response.next_cursor;if(!cursor)break;
  }
  assert.equal(seen.length,30);assert.equal(new Set(seen).size,30);assert.deepEqual(new Set(seen),new Set(history.map(item=>item.id)));
});

test('invalid, oversized or cross-view cursors fail closed and malformed events cannot expose arbitrary data',async t=>{
  const f=await fixture(t);f.add('run_bad',{approval:{id:'private',step:99,operation:'script',status:'pending',context:{password:'NEVER_INCLUDE'}}},'running');
  for(const query of ['?view=other','?limit=0','?limit=101','?cursor=not-json','?cursor='+ 'a'.repeat(1025),'?unexpected=secret'])assert.equal((await f.get(query)).status,400);
  const cursor=Buffer.from(JSON.stringify({view:'history',at:new Date().toISOString(),id:'run_bad'})).toString('base64url');assert.equal((await f.get('?cursor='+cursor)).status,400);
  assert.deepEqual((await f.get()).value.items,[]);assert.deepEqual((await f.get('?view=history')).value.items,[]);
});
