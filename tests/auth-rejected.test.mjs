import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {installCompatibilityFixture} from './compatibility-fixture.mjs';

test('a provider browser refusal cannot be confirmed or recorded as an authenticated account',{timeout:30000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const {app,origin}=await createApp({port:4354,dataDir:resolve('work/auth-rejected-tests',randomBytes(6).toString('hex'))});
  installCompatibilityFixture(app);await app.listen({port:4354,host:'127.0.0.1'});
  let cookie='',csrf='';
  const call=async(path,body)=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:4354',cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=String(r.headers['set-cookie']).split(';')[0];return r;};
  try{
    csrf=(await call('/studio/session')).json().csrf;csrf=(await call('/studio/setup',{password:'synthetic-refusal-test-password'})).json().csrf;
    const c=(await call('/studio/connections',{name:'Owned sign-in rejection fixture',url:origin+'/sandbox/compat-auth-rejected',authorized:true})).json().connection;
    assert.equal((await call(`/studio/connections/${c.id}/open`,{})).statusCode,200);
    const response=await call(`/studio/connections/${c.id}/browser`),snapshot=response.json();assert.equal(response.statusCode,200,response.body);
    assert.equal(snapshot.state,'auth_rejected');assert.equal(snapshot.can_confirm,false);assert.equal(snapshot.elements.some(item=>item.kind==='output'),false);
    assert.equal((await call(`/studio/connections/${c.id}/confirm`,{element_id:'refused-page-text'})).statusCode,409);
    assert.equal((await call('/studio/recordings',{connection_id:c.id,name:'Refused account',slug:'refused.account'})).statusCode,409);
  }finally{await app.close();}
});
