import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

const engineFactory=async()=>({closeAll:async()=>{},closeStudios:async()=>{}});
const formerRoutes=[
  ['GET','/studio/chatgpt'],['POST','/studio/chatgpt/start'],
  ['GET','/studio/chatgpt/models'],['POST','/studio/chatgpt/test'],
  ['POST','/studio/chatgpt/key'],['POST','/studio/chatgpt/revoke-key'],
  ['POST','/studio/chatgpt/disconnect'],['GET','/oauth/chatgpt/callback'],
  ['POST','/v1/chatgpt/responses'],
];

test('removed provider routes cannot authorize old keys or bypass owner and origin guards',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/provider-removal-tests',randomBytes(6).toString('hex'));
  let instance=await createApp({port:4405,dataDir,browserEngineFactory:engineFactory});
  let cookie='',csrf='';
  const request=async(method,url,payload,extra={})=>{
    const r=await instance.app.inject({method,url,headers:{host:'127.0.0.1:4405',cookie,...(method==='GET'?{}:{'x-hermo-csrf':csrf}),...extra},...(payload===undefined?{}:{payload})});
    const set=r.headers['set-cookie'];
    if(set)for(const value of Array.isArray(set)?set:[set]){
      const pair=value.split(';')[0],name=pair.split('=')[0];
      cookie=cookie.split('; ').filter(value=>value&&!value.startsWith(name+'=')).concat(pair).join('; ');
    }
    return r;
  };
  try{
    await instance.app.ready();
    for(const [method,url]of formerRoutes)assert.equal(instance.app.hasRoute({method,url}),false,`No registration remains for ${method} ${url}`);
    assert.equal(instance.app.hasRoute({method:'GET',url:'/oauth/google/callback'}),true);
    assert.equal(instance.app.hasRoute({method:'POST',url:'/v1/actions/:slug/versions/1/runs'}),true);
    assert.equal((await request('GET','/studio/chatgpt')).statusCode,401);
    csrf=(await request('GET','/studio/session')).json().csrf;
    csrf=(await request('POST','/studio/setup',{password:'owned-universal-test-password'})).json().csrf;
    for(const [method,url]of formerRoutes.filter(([,url])=>url.startsWith('/studio/'))){
      assert.equal((await request(method,url,method==='GET'?undefined:{})).statusCode,404,`Authenticated ${method} ${url} is removed`);
    }
    assert.equal((await request('POST','/studio/chatgpt/start',{}, {'x-hermo-csrf':'wrong'})).statusCode,403,'Removed owner routes do not bypass CSRF');
    assert.equal((await request('GET','/oauth/chatgpt/callback?state=old&code=old')).statusCode,404);
    assert.equal((await request('GET','/oauth/chatgpt/callback?state=old&code=old',undefined,{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'})).statusCode,403,'The old callback no longer has a cross-site exemption');
    assert.equal((await request('GET','/oauth/google/callback?state=invalid&code=invalid')).statusCode,400,'Google callback remains registered and validates flow state');

    const stamp=new Date().toISOString(),liveKey='hm_live_'+randomBytes(32).toString('base64url'),oldKey='hm_chat_'+randomBytes(32).toString('base64url');
    const legacyValues={chatgpt_plan:instance.store.seal({tokens:{access_token:'owned-legacy-token'}}),chatgpt_plan_keys:instance.store.seal([{hash:hash(oldKey),expires:Date.now()+86400000}]),chatgpt_host_id:'urn:uuid:owned-old-id'};
    for(const[name,value]of Object.entries(legacyValues))instance.store.setSetting(name,value);
    instance.store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('con_ordinary','Ordinary website','https://example.test/','connected',instance.store.seal({access:'public',origins:['https://example.test'],browser_mode:'isolated'}),stamp);
    const definition={action_type:'custom',effect:'retrieval',inputs:{},outputs:[{name:'value',selector:'#value'}],steps:[],verifiers:[]};
    instance.store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_ordinary','con_ordinary','Ordinary action','ordinary.action','published','v1',instance.store.seal(definition),'v1',stamp);
    instance.store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_ordinary','Ordinary key',hash(liveKey),liveKey.slice(-6),'wf_ordinary',new Date(Date.now()+86400000).toISOString(),null,stamp);
    assert.equal((await request('POST','/v1/chatgpt/responses',{model:'old',input:'old'},{authorization:'Bearer '+oldKey})).statusCode,401,'Encrypted legacy key cannot authorize removed endpoint');
    assert.equal((await request('GET','/v1/action-contract',undefined,{authorization:'Bearer '+oldKey})).statusCode,401,'Legacy key cannot authorize ordinary website action');
    assert.equal((await request('POST','/v1/chatgpt/responses',{}, {authorization:'Bearer '+liveKey})).statusCode,404,'Even a valid generic key cannot invoke removed provider route');
    const contract=await request('GET','/v1/action-contract',undefined,{authorization:'Bearer '+liveKey});
    assert.equal(contract.statusCode,200);assert.equal(contract.json().action,'ordinary.action');
    const exported=await request('GET','/studio/privacy-export');
    assert.equal(exported.statusCode,200);assert.equal(exported.body.includes('owned-legacy-token'),false);assert.equal(exported.body.includes(oldKey),false);
    assert.equal((await request('POST','/studio/logout',{})).statusCode,200);
    assert.equal((await request('GET','/studio/overview')).statusCode,401);
    await instance.app.close();
    instance=await createApp({port:4405,dataDir,browserEngineFactory:engineFactory});
    for(const[name,value]of Object.entries(legacyValues))assert.equal(instance.store.getSetting(name),value,'Removal and restart leave protected legacy owner settings intact');
    assert.equal(instance.store.db.prepare('SELECT count(*) n FROM workflows').get().n,1,'Generic action persists through restart');
    assert.equal(instance.store.db.prepare('SELECT count(*) n FROM api_keys').get().n,1,'Generic consumer key persists through restart');
  }finally{await instance.app.close();}
});

test('provider setup and example assets are absent from source and the rebuilt application',async()=>{
  for(const path of ['src/ChatGPTPlan.tsx','server/chatgpt.mjs','public/chatgpt-plan.html','public/chatgpt-example.html','public/chatgpt-example.js','public/chatgpt-example.css'])assert.equal(existsSync(resolve(path)),false,path);
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const {app}=await createApp({port:4406,dataDir:resolve('work/provider-removal-tests',randomBytes(6).toString('hex')),browserEngineFactory:engineFactory});
  try{
    for(const path of ['/chatgpt-plan.html','/chatgpt-example.html','/chatgpt-example.js','/chatgpt-example.css']){
      assert.equal(existsSync(resolve('dist'+path)),false,'Rebuild must remove the old copied asset: '+path);
      const response=await app.inject({method:'GET',url:path,headers:{host:'127.0.0.1:4406'}});
      assert.equal(response.statusCode,404,'Removed static feature has no fallback return page: '+path);
    }
  }finally{await app.close();}
});
