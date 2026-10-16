import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createApp} from '../server/index.mjs';
import {validateGoogleCookies,isCompanionRequest} from '../server/google-companion.mjs';
import {normalChromeArguments} from '../server/normal-chrome.mjs';
import {transferGoogleSession,normalizeCookies,localWorkspace,googleOrigins} from '../companion/chrome/transfer.mjs';

const extensionId='abcdefghijklmnopabcdefghijklmnop',extensionOrigin='chrome-extension://'+extensionId;
const syntheticCookie={name:'__Secure-1PSID',value:'synthetic-local-google-cookie',domain:'.google.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'None'};
const chromeCookie={...syntheticCookie,hostOnly:false,session:true,sameSite:'no_restriction'};

test('normal Chrome uses a dedicated profile without automation or debug flags',()=>{
  const args=normalChromeArguments('D:/Projects/Hermo/work/synthetic-native-profile');
  assert.ok(args[0].endsWith('normal-chrome'));assert.equal(args.at(-1),'https://accounts.google.com/');
  assert.equal(args.some(x=>/debug|automation|headless|disable|proxy|load-extension/i.test(x)),false);
});
test('companion strictly limits cookie scope and local transport',async()=>{
  assert.equal(validateGoogleCookies([syntheticCookie]).length,1);
  for(const c of [{...syntheticCookie,domain:'evilgoogle.com'},{...syntheticCookie,domain:'.google.com.attacker.test'},{...syntheticCookie,domain:'.chatgpt.com'},{...syntheticCookie,value:'bad\nvalue'},{...syntheticCookie,value:'x'.repeat(4097)},{...syntheticCookie,expires:0},{...syntheticCookie,sameSite:'unknown'},{...syntheticCookie,unexpected:true}])assert.throws(()=>validateGoogleCookies([c]));
  assert.throws(()=>validateGoogleCookies([syntheticCookie,syntheticCookie]));assert.throws(()=>validateGoogleCookies([{...syntheticCookie,name:'PREF'}]),/GOOGLE_SIGN_IN_REQUIRED/);
  for(const invalid of [{...syntheticCookie,secure:false},{...syntheticCookie,name:'__Host-SID'},{...syntheticCookie,name:'__Host-SID',domain:'accounts.google.com',path:'/signin'},{...syntheticCookie,name:'SID',secure:false,sameSite:'None'}])assert.throws(()=>validateGoogleCookies([syntheticCookie,invalid]),/INVALID_GOOGLE_COOKIES/);
  assert.equal(localWorkspace('http://127.0.0.1:4318'),'http://127.0.0.1:4318');
  for(const value of ['https://attacker.test','http://127.0.0.1.attacker.test','http://localhost:4318','http://user:pass@127.0.0.1:4318','http://127.0.0.1:4318/?code=secret','http://127.0.0.1:4318/#secret','http://127.0.0.1:4318/studio'])assert.throws(()=>localWorkspace(value));
  assert.equal(normalizeCookies([[chromeCookie],[chromeCookie]]).length,1);
  assert.equal(normalizeCookies([[{...chromeCookie,partitionKey:{topLevelSite:'https://attacker.test'}}]]).length,0);
  assert.equal(isCompanionRequest({method:'POST',headers:{origin:'https://attacker.test','x-hermo-extension-id':extensionId}},'/companion/google/import'),false);
  assert.equal(isCompanionRequest({method:'POST',headers:{origin:extensionOrigin,'x-hermo-extension-id':extensionId}},'/studio/overview'),false);
  const manifest=JSON.parse(await readFile(new URL('../companion/chrome/manifest.json',import.meta.url)));
  assert.equal(manifest.background,undefined);assert.equal(manifest.content_scripts,undefined);assert.deepEqual(manifest.optional_permissions,['cookies']);assert.equal(manifest.optional_host_permissions.some(x=>x.includes('*://')||x.includes('*.')),false);
  assert.deepEqual(manifest.optional_host_permissions,googleOrigins.map(origin=>origin+'/*'));
  assert.ok(manifest.optional_host_permissions.includes('https://google.com/*'));
});

test('one-use normal Chrome import is password/owner bound, encrypted, scoped and unusable after lock',{timeout:30000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');let launched=0;
  const engine={closeAll:async()=>{},closeStudios:async()=>{}};
  const {app,store}=await createApp({port:4346,dataDir:resolve('work/companion-tests',randomBytes(6).toString('hex')),browserEngineFactory:async()=>engine,normalBrowserLauncher:async()=>{launched++;}});
  let cookie='',csrf='';
  async function owner(path,body,extra={}){const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:4346',cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...extra},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=String(r.headers['set-cookie']).split(';')[0];return r;}
  const start=()=>owner('/studio/browser-profiles/normal-chrome',{name:'Synthetic normal Chrome',authorized:true,password:'synthetic-companion-owner-password'});
  const importCall=(code,payload={cookies:[syntheticCookie],authorized:true},extra={})=>app.inject({method:'POST',url:'/companion/google/import',headers:{host:'127.0.0.1:4346',origin:extensionOrigin,'x-hermo-extension-id':extensionId,authorization:'Bearer '+code,'sec-fetch-site':'cross-site',...extra},payload});
  try{
    assert.equal((await start()).statusCode,401);assert.equal(launched,0);
    csrf=(await owner('/studio/session')).json().csrf;csrf=(await owner('/studio/setup',{password:'synthetic-companion-owner-password'})).json().csrf;
    assert.equal((await owner('/studio/browser-profiles/normal-chrome',{name:'Synthetic',authorized:true,password:'wrong'},{'x-hermo-csrf':'wrong'})).statusCode,403);
    assert.equal((await owner('/studio/browser-profiles/normal-chrome',{name:'Synthetic',authorized:true,password:'wrong'})).statusCode,401);assert.equal(launched,0);
    const a=await start();assert.equal(a.statusCode,200,a.body);const code=a.json().code;assert.match(code,/^hi_import_[A-Za-z0-9_-]{43}$/);assert.equal(launched,1);
    assert.equal(a.json().workspace_origin,'http://127.0.0.1:4346');
    const preflight=await app.inject({method:'OPTIONS',url:'/companion/google/import',headers:{host:'127.0.0.1:4346',origin:extensionOrigin,'sec-fetch-site':'cross-site'}});assert.equal(preflight.statusCode,204);assert.equal(preflight.headers['access-control-allow-origin'],extensionOrigin);
    assert.equal((await importCall(code,undefined,{origin:'https://attacker.test'})).statusCode,403);
    assert.equal((await importCall(code,undefined,{host:'attacker.test'})).statusCode,403);
    assert.equal((await app.inject({method:'GET',url:'/studio/overview',headers:{host:'127.0.0.1:4346',origin:extensionOrigin,'x-hermo-extension-id':extensionId,authorization:'Bearer '+code}})).statusCode,403);
    assert.equal((await importCall('hi_import_'+randomBytes(32).toString('base64url'))).statusCode,401);
    assert.equal((await importCall(code,{cookies:[syntheticCookie],authorized:false})).statusCode,400);
    assert.equal((await importCall(code,{cookies:[{...syntheticCookie,domain:'.chatgpt.com'}],authorized:true})).statusCode,400);
    let requested=[];const chrome={runtime:{id:extensionId},permissions:{request:async value=>{requested=value.origins;return true;}},cookies:{getAll:async()=>[chromeCookie]}};
    const localFetch=async(url,opts)=>{assert.equal(url,'http://127.0.0.1:4346/companion/google/import');assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');const r=await importCall(code,JSON.parse(opts.body),opts.headers);return new Response(r.body,{status:r.statusCode,headers:r.headers});};
    const imported=await transferGoogleSession({chrome,fetch:localFetch,origin:'http://127.0.0.1:4346',code,authorized:true});assert.equal(imported.ok,true);assert.deepEqual(requested,googleOrigins.map(x=>x+'/*'));
    assert.equal((await importCall(code)).statusCode,401);
    const encrypted=store.getSetting('google_browser_profiles');assert.equal(encrypted.includes(syntheticCookie.value),false);const profile=store.unseal(encrypted)[0];assert.equal(profile.source,'normal_chrome_cookies');assert.equal(profile.storageState.cookies[0].value,syntheticCookie.value);
    const c=store.db.prepare('SELECT * FROM connections WHERE id=?').get(profile.connection_id),state=store.unseal(c.payload);assert.equal(c.status,'auth_required');assert.equal(state.storageState,undefined);assert.equal(state.identity,undefined);assert.equal(state.studioState.storageState.cookies[0].value,syntheticCookie.value);
    for(const path of ['/studio/overview','/studio/privacy-export','/studio/audit','/studio/browser-profiles']){const r=await owner(path);assert.equal(r.body.includes(syntheticCookie.value),false);assert.equal(r.body.includes(code),false);}
    const b=(await start()).json().code,latest=(await start()).json().code;assert.equal((await importCall(b)).statusCode,401);
    t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.timers.tick(11*60000);assert.equal((await importCall(latest)).statusCode,401);t.mock.timers.reset();
    const lockCode=(await start()).json().code;await owner('/studio/logout',{});assert.equal((await importCall(lockCode)).statusCode,401);
  }finally{t.mock.timers.reset();await app.close();}
});

test('companion performs no collection or transfer without permission and explicit intent',async()=>{
  let read=0,sent=0;const chrome={runtime:{id:extensionId},permissions:{request:async()=>false},cookies:{getAll:async()=>{read++;return [];}}},fetch=async()=>{sent++;};
  const args={chrome,fetch,origin:'http://127.0.0.1:4318',code:'hi_import_'+randomBytes(32).toString('base64url'),authorized:true};
  await assert.rejects(()=>transferGoogleSession({...args,authorized:false}));await assert.rejects(()=>transferGoogleSession({...args,origin:'https://attacker.test'}));await assert.rejects(()=>transferGoogleSession(args),/not granted/);assert.equal(read,0);assert.equal(sent,0);
});

test('companion can read shared Google sign-in cookies with exact apex permission and all cookie paths',async()=>{
  // Match Chromium's GetPageAccess(cookie domain URL) gate, rather than a mock
  // that returns an authentication cookie regardless of host permissions.
  const permissions=new Set(),queries=[];
  const stored=[{...chromeCookie,session:false,expirationDate:Date.now()/1000+3600,storeId:'0'},
    {...chromeCookie,name:'ACCOUNT_PATH',domain:'accounts.google.com',hostOnly:true,path:'/signin',storeId:'0'},
    {...chromeCookie,name:'SID',storeId:'1',value:'synthetic-other-store'}];
  const chrome={runtime:{id:extensionId},permissions:{request:async request=>{
    request.origins.forEach(origin=>permissions.add(origin));return true;
  }},cookies:{getAll:async details=>{
    queries.push(details);
    return stored.filter(cookie=>{
      if(cookie.storeId!==(details.storeId??'0'))return false;
      const host=cookie.domain.replace(/^\./,'');
      if(!permissions.has('https://'+host+'/*'))return false;
      if(details.domain&&host!==details.domain&&!host.endsWith('.'+details.domain))return false;
      if(details.url){const u=new URL(details.url);if(u.hostname!==host&&!u.hostname.endsWith('.'+host)||!u.pathname.startsWith(cookie.path))return false;}
      return true;
    });
  }}};
  googleOrigins.filter(origin=>origin!=='https://google.com').forEach(origin=>permissions.add(origin+'/*'));
  assert.equal((await chrome.cookies.getAll({url:'https://accounts.google.com/'})).length,0,'old access incorrectly hides the signed-in cookie');
  queries.length=0;let sent=0;
  const result=await transferGoogleSession({chrome,origin:'http://127.0.0.1:4318',authorized:true,
    code:'hi_import_'+randomBytes(32).toString('base64url'),fetch:async(url,options)=>{
      sent++;assert.equal(url,'http://127.0.0.1:4318/companion/google/import');
      const payload=JSON.parse(options.body);assert.equal(payload.cookies.length,2);
      assert.ok(payload.cookies.some(cookie=>cookie.name==='__Secure-1PSID'));
      assert.ok(payload.cookies.some(cookie=>cookie.path==='/signin'));
      assert.equal(options.body.includes('synthetic-other-store'),false);
      assert.equal(validateGoogleCookies(payload.cookies).length,2);
      return new Response(JSON.stringify({ok:true}));
    }});
  assert.equal(result.ok,true);assert.equal(sent,1);
  assert.ok(queries.every(query=>Object.keys(query).length===1&&typeof query.domain==='string'));
});

test('companion distinguishes unreadable and unsupported sign-in without leaking cookie data',async()=>{
  let reads=0,sent=0;
  const chrome={runtime:{id:extensionId},extension:{inIncognitoContext:false},
    permissions:{request:async()=>true},cookies:{getAll:async()=>{reads++;return [];}}};
  const args={chrome,fetch:async()=>{sent++;},origin:'http://127.0.0.1:4318',authorized:true,
    code:'hi_import_'+randomBytes(32).toString('base64url')};
  await assert.rejects(()=>transferGoogleSession(args),/No readable Google website session/);
  chrome.cookies.getAll=async()=>[{...chromeCookie,name:'PREF',value:'private-preference-value'}];
  await assert.rejects(()=>transferGoogleSession(args),error=>error.message.includes('no supported sign-in cookie')&&!error.message.includes('private-preference-value')&&!error.message.includes('PREF'));
  chrome.cookies.getAll=async()=>[{...chromeCookie,domain:'.google.com.attacker.test'},
    {...chromeCookie,domain:'.com'},{...chromeCookie,domain:'google.com',hostOnly:true},
    {...chromeCookie,expirationDate:1,session:false},
    {...chromeCookie,partitionKey:{topLevelSite:'https://google.com'}}];
  await assert.rejects(()=>transferGoogleSession(args),/No readable Google website session/);
  chrome.cookies.getAll=async()=>{throw Error('private-browser-error');};
  await assert.rejects(()=>transferGoogleSession(args),error=>error.message.includes('Chrome could not read')&&!error.message.includes('private-browser-error'));
  chrome.extension.inIncognitoContext=true;const previousReads=reads;
  await assert.rejects(()=>transferGoogleSession(args),/Incognito/);
  assert.equal(reads,previousReads);assert.equal(sent,0);
});
