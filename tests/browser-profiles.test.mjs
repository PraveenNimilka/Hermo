import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';
import {filterProfileState,mergeProfileState,googleBrowserOrigins} from '../server/browser-profiles.mjs';
import {hash} from '../server/store.mjs';

const cookie=(domain,name,value)=>({domain,name,value,path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'});
test('Google profile filtering keeps only approved Google domains and handles cookie scope safely',()=>{
  const state={cookies:[cookie('.google.com','session','allowed'),cookie('accounts.google.com','host-only','allowed'),cookie('.chatgpt.com','other-session','private'),cookie('evilgoogle.com','lookalike','private'),cookie('.google.com.attacker.test','suffix','private')],origins:[{origin:'https://accounts.google.com',localStorage:[]},{origin:'https://chatgpt.com',localStorage:[{name:'secret',value:'private'}]}]};
  const filtered=filterProfileState(state);assert.equal(filtered.cookies.length,2);assert.equal(filtered.origins.length,1);assert.equal(JSON.stringify(filtered).includes('private'),false);
  const merged=mergeProfileState({cookies:[cookie('accounts.google.com','host-only','old'),cookie('.chatgpt.com','app-session','kept')],origins:[]},filtered);
  assert.equal(merged.cookies.filter(x=>x.name==='host-only').length,1);assert.equal(merged.cookies.find(x=>x.name==='host-only').value,'allowed');assert.equal(merged.cookies.find(x=>x.name==='app-session').value,'kept');
});

test('private Google profiles require owner/CSRF/ready email marker, encrypt credentials and revoke dependent keys',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const dataDir=resolve('work/browser-profile-tests',randomBytes(6).toString('hex')),secret='synthetic-google-browser-session';
  // Fixture identity is deliberately synthetic. This tests protocol/storage
  // enforcement, not acceptance of an actual Google account by Google.
  let state='ready',marker='synthetic@example.test',open=true,framed=false;
  const engine={snapshot:async()=>({url:'https://myaccount.google.com/',state,can_confirm:state==='ready'}),element:()=>({frame_path:framed?['iframe']:[]}),read:async()=>marker,save:async()=>({checkpoint:'https://myaccount.google.com/?private=discarded',storageState:{cookies:[cookie('.google.com','GoogleSession',secret),cookie('.chatgpt.com','OtherSession','excluded-credential')],origins:[]}}),close:async()=>{open=false;},open:async()=>{open=true;},addTab:async()=>{},isOpen:()=>open,allowOrigins:()=>{},closeAll:async()=>{},closeStudios:async()=>{open=false;}};
  let current=await createApp({port:4341,dataDir,browserEngineFactory:async()=>engine}),cookies='',csrf='';
  const call=async(url,body,headers={})=>{const r=await current.app.inject({method:body===undefined?'GET':'POST',url,headers:{host:'127.0.0.1:4341',cookie:cookies,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});const raw=r.headers['set-cookie'];if(raw)cookies=(Array.isArray(raw)?raw[0]:raw).split(';')[0];return r;};
  try{
    assert.equal((await call('/studio/browser-profiles')).statusCode,401);
    csrf=(await call('/studio/session')).json().csrf;csrf=(await call('/studio/setup',{password:'synthetic-profile-owner-password'})).json().csrf;
    const source=(await call('/studio/connections',{name:'Google profile fixture',url:'https://myaccount.google.com/',authorized:true})).json().connection;
    const body={connection_id:source.id,element_id:'synthetic-marker',name:'Synthetic Google browser'};
    assert.equal((await call('/studio/browser-profiles',body,{'x-hermo-csrf':'bad'})).statusCode,403);
    for(const blocked of ['challenge','sign_in','network_error','blocked']){state=blocked;assert.equal((await call('/studio/browser-profiles',body)).statusCode,409);}state='ready';
    marker='Google privacy settings';assert.equal((await call('/studio/browser-profiles',body)).statusCode,422);marker='synthetic@example.test';framed=true;assert.equal((await call('/studio/browser-profiles',body)).statusCode,422);framed=false;
    const saved=await call('/studio/browser-profiles',body);assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.body.includes(secret),false);const profile=saved.json().profile;
    const stored=current.store.getSetting('google_browser_profiles');assert.equal(stored.includes(secret),false);assert.equal(JSON.stringify(current.store.unseal(stored)).includes('excluded-credential'),false);
    let c=current.store.unseal(current.store.db.prepare('SELECT payload FROM connections WHERE id=?').get(source.id).payload);assert.equal(c.studioState.checkpoint,'https://myaccount.google.com/');assert.equal(c.storageState,undefined);
    for(const path of ['/studio/browser-profiles','/studio/overview','/studio/privacy-export','/studio/audit']){const r=await call(path);assert.equal(r.body.includes(secret),false);assert.equal(r.body.includes('excluded-credential'),false);}
    assert.equal((await call('/studio/browser-profiles',body,{origin:'https://attacker.test'})).statusCode,403);
    const pub=(await call('/studio/connections',{name:'Anonymous',url:'http://127.0.0.1:4341/sandbox/',access:'public',authorized:true})).json().connection;
    assert.equal((await call(`/studio/connections/${pub.id}/browser-profile`,{profile_id:profile.id,authorized:true})).statusCode,400);
    assert.equal((await call('/studio/connections',{name:'Anonymous seed',url:'https://example.com/',access:'public',browser_profile_id:profile.id,authorized:true})).statusCode,400);
    const target=(await call('/studio/connections',{name:'Private app',url:'http://127.0.0.1:4341/sandbox/',authorized:true})).json().connection;
    const consumer='hm_live_'+randomBytes(32).toString('base64url'),stamp=new Date().toISOString();
    current.store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_profile',target.id,'Fixture','profile.fixture','published','1',current.store.seal({inputs:{},outputs:[],steps:[],verifiers:[]}),'1',stamp);
    current.store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_profile','Fixture',hash(consumer),'suffix','wf_profile','2099-01-01T00:00:00.000Z',null,stamp);
    assert.equal((await call(`/studio/connections/${target.id}/google-sign-in`,{})).statusCode,409);
    assert.equal((await call(`/studio/connections/${target.id}/browser-profile`,{profile_id:profile.id,authorized:false})).statusCode,400);
    const applied=await call(`/studio/connections/${target.id}/browser-profile`,{profile_id:profile.id,authorized:true});assert.equal(applied.statusCode,200,applied.body);
    c=current.store.unseal(current.store.db.prepare('SELECT payload FROM connections WHERE id=?').get(target.id).payload);assert.equal(c.studioState.storageState.cookies[0].value,secret);assert.equal(c.storageState,undefined);assert.ok(googleBrowserOrigins.every(o=>c.origins.includes(o)));
    assert.equal(current.store.db.prepare('SELECT status FROM workflows WHERE id=?').get('wf_profile').status,'draft');assert.ok(current.store.db.prepare('SELECT revoked_at FROM api_keys WHERE id=?').get('key_profile').revoked_at);
    assert.equal((await call('/v1/actions/profile.fixture/versions/1/runs',{input:{}},{authorization:'Bearer '+consumer})).statusCode,401);
    assert.equal((await call(`/studio/connections/${target.id}/google-sign-in`,{})).statusCode,200);
    engine.snapshot=async()=>{throw Error('Synthetic screenshot timeout');};open=true;
    assert.equal((await call(`/studio/connections/${target.id}/browser`)).json().error.code,'BROWSER_PREVIEW_FAILED');open=false;
    assert.equal((await call(`/studio/connections/${target.id}/browser`)).json().error.code,'BROWSER_CLOSED');
    await current.app.close();current=await createApp({port:4341,dataDir,browserEngineFactory:async()=>engine});cookies='';csrf=(await call('/studio/session')).json().csrf;
    assert.equal((await call('/studio/browser-profiles')).statusCode,401);csrf=(await call('/studio/login',{password:'synthetic-profile-owner-password'})).json().csrf;
    assert.equal((await call('/studio/browser-profiles')).json().profiles[0].id,profile.id);
    const revoked=await call(`/studio/browser-profiles/${profile.id}/revoke`,{});assert.equal(revoked.statusCode,200);assert.equal(revoked.json().affected_connections,2);
    for(const cid of [source.id,target.id]){const row=current.store.db.prepare('SELECT payload,status FROM connections WHERE id=?').get(cid);const value=current.store.unseal(row.payload);assert.equal(row.status,'auth_required');assert.equal(value.studioState,undefined);assert.equal(value.storageState,undefined);}
    assert.deepEqual((await call('/studio/browser-profiles')).json().profiles,[]);
  }finally{await current.app.close();}
});

test('real isolated browser restores a saved draft after close and keeps public replay anonymous',{timeout:60000},async()=>{
  const fixture=http.createServer((req,res)=>{const signedIn=req.headers.cookie?.includes('synthetic_session=kept');res.writeHead(200,{'content-type':'text/html'}).end(`<p id="identity">${signedIn?'Synthetic signed-in account':'Synthetic signed-out account'}</p><button>Continue</button>`);});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+fixture.address().port,proxy=await createEgressProxy(origin);let engine;
  try{
    engine=await createBrowserEngine(proxy,origin);const c={url:origin+'/sandbox/',origins:[origin],access:'account'};
    const studio=await engine.open('draft',c);await studio.ctx.addCookies([{name:'synthetic_session',value:'kept',url:origin}]);await engine.interact('draft',{op:'home'});
    const saved=await engine.save('draft');await engine.close('draft');assert.equal(engine.isOpen('draft'),false);
    await engine.open('draft',{...c,studioState:saved});assert.ok((await engine.snapshot('draft')).elements.some(e=>e.preview==='Synthetic signed-in account'));
    await engine.open('anonymous',{...c,access:'public',studioState:saved,storageState:saved.storageState});assert.ok((await engine.snapshot('anonymous')).elements.some(e=>e.preview==='Synthetic signed-out account'));
    await engine.addTab('draft',origin+'/sandbox/second');const tabs=(await engine.snapshot('draft')).tabs;assert.equal(tabs.length,2);assert.equal(tabs.find(t=>t.active).url,origin+'/sandbox/second');
  }finally{await engine?.closeAll();await proxy.close();await new Promise(r=>fixture.close(r));}
});
