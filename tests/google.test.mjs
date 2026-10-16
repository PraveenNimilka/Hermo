import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {generateKeyPair,SignJWT} from 'jose';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import http from 'node:http';
import {chromium} from 'playwright';
import {createGoogleProvider} from '../server/google.mjs';
import {createApp} from '../server/index.mjs';

const clientId='hermo-test.apps.googleusercontent.com';
test('real Chromium follows cross-site OAuth returns, restores owner access and handles cancellation',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4340,flows=new Map(),password='synthetic-browser-oauth-password';
  // Owned localhost consent fixture is a different site from Hermo's 127.0.0.1.
  // It exercises browser redirects/cookies, never an actual Google account.
  const consent=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),state=url.searchParams.get('state');
    if(!flows.has(state)){res.writeHead(400).end();return;}
    const callback=`http://127.0.0.1:${port}/oauth/google/callback?state=${encodeURIComponent(state)}`;
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'}).end(`<a href="${callback}&code=synthetic-code">Continue with synthetic account</a><a href="${callback}&error=access_denied">Cancel synthetic consent</a>`);
  });
  await new Promise(r=>consent.listen(0,r));const consentPort=consent.address().port;
  const provider={configured:true,authorization(flow){flows.set(flow.state,flow);return `http://localhost:${consentPort}/?state=${flow.state}`;},async exchange({nonce,verifier}){assert.ok([...flows.values()].some(f=>f.nonce===nonce&&f.verifier===verifier));return {sub:'browser-owner',email:'synthetic@example.test',name:'Synthetic Owner'};}};
  let app,browser;
  try{
    ({app}=await createApp({port,dataDir:resolve('work/google-browser-tests',randomBytes(6).toString('hex')),googleProvider:provider}));await app.listen({port,host:'127.0.0.1'});
    const executablePath=process.env.HERMO_BROWSER_PATH??(existsSync(chromium.executablePath())?undefined:['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync));
    browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath});
    const context=await browser.newContext(),page=await context.newPage(),origin=`http://127.0.0.1:${port}`;
    let response=await context.request.get(origin+'/studio/session'),csrf=(await response.json()).csrf;
    response=await context.request.post(origin+'/studio/setup',{headers:{'x-hermo-csrf':csrf},data:{password}});assert.equal(response.status(),200);csrf=(await response.json()).csrf;
    const begin=async purpose=>{
      const r=await context.request.post(origin+'/studio/google/start',{headers:{'x-hermo-csrf':csrf},data:{purpose,...purpose==='link'?{password}:{}}});assert.equal(r.status(),200);await page.goto((await r.json()).authorization_url);
    };
    const landings=[];page.on('request',r=>{if(r.isNavigationRequest()&&new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/')landings.push(r);});
    await begin('link');await page.getByRole('link',{name:'Continue with synthetic account'}).click();await page.waitForURL(origin+'/#privacy');
    assert.equal((await landings.at(-1).allHeaders())['sec-fetch-site'],'cross-site');
    await page.waitForFunction(()=>document.querySelector('#root')?.children.length>0);
    const owner=await page.evaluate(async()=>{const r=await fetch('/studio/session');return {status:r.status,value:await r.json()};});
    assert.equal(owner.status,200);assert.equal(owner.value.authenticated,true);assert.equal(owner.value.google.linked,true);csrf=owner.value.csrf;
    assert.equal((await context.request.post(origin+'/studio/logout',{headers:{'x-hermo-csrf':csrf},data:{}})).status(),200);
    const anonymous=await (await context.request.get(origin+'/studio/session')).json();assert.equal(anonymous.authenticated,false);csrf=anonymous.csrf;
    await begin('login');await page.getByRole('link',{name:'Continue with synthetic account'}).click();await page.waitForURL(origin+'/');
    const signedIn=await page.evaluate(async()=>{const r=await fetch('/studio/session');return {status:r.status,value:await r.json()};});assert.equal(signedIn.status,200);assert.equal(signedIn.value.authenticated,true);csrf=signedIn.value.csrf;
    await begin('login');await page.getByRole('link',{name:'Cancel synthetic consent'}).click();await page.waitForURL(origin+'/?google=cancelled');
    assert.equal((await page.request.get(origin+'/')).status(),200);assert.equal((await landings.at(-1).allHeaders())['sec-fetch-site'],'cross-site');
  }finally{await browser?.close();await app?.close();await new Promise(r=>consent.close(r));}
});
test('OAuth return permits only public top-level GET navigation while private routes remain cross-site blocked',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const {app}=await createApp({port:4339,dataDir:resolve('work/google-return-tests',randomBytes(6).toString('hex'))});
  const navigation={host:'127.0.0.1:4339','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
  try{
    const landing=await app.inject({method:'GET',url:'/?google=cancelled',headers:navigation});
    assert.equal(landing.statusCode,200,landing.body);assert.match(landing.headers['content-type'],/text\/html/);
    assert.equal(landing.headers['set-cookie'],undefined);assert.match(landing.headers['content-security-policy'],/frame-ancestors 'none'/);
    for(const path of ['/studio/session','/studio/overview','/studio/google','/studio/privacy-export','/v1/actions/test','/mcp','/unknown']){
      const r=await app.inject({method:'GET',url:path,headers:navigation});assert.equal(r.statusCode,403,path);assert.equal(r.json().error.code,'ORIGIN_BLOCKED');
    }
    for(const headers of [{...navigation,'sec-fetch-mode':'cors'},{...navigation,'sec-fetch-dest':'iframe'},{...navigation,'sec-fetch-dest':'empty'},{...navigation,origin:'https://attacker.example'},{...navigation,host:'attacker.example'}])assert.equal((await app.inject({method:'GET',url:'/',headers})).statusCode,403);
    for(const method of ['POST','HEAD','OPTIONS'])assert.equal((await app.inject({method,url:'/',headers:navigation})).statusCode,403,method);
  }finally{await app.close();}
});
test('local Google client setup requires owner password and CSRF, encrypts the secret and survives restart',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const dataDir=resolve('work/google-config-tests',randomBytes(6).toString('hex'));
  let state=await createApp({port:4337,dataDir}),cookie='',csrf='';const secret='synthetic-local-google-secret';
  const call=async(url,body,extra={})=>{const r=await state.app.inject({method:body===undefined?'GET':'POST',url,headers:{host:'127.0.0.1:4337',cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...extra},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return r;};
  try{
    let r=await call('/studio/session');csrf=r.json().csrf;const config={clientId,clientSecret:secret,password:'synthetic-config-owner-password'};
    assert.equal((await call('/studio/google/configure',config)).statusCode,401);
    r=await call('/studio/setup',{password:config.password});csrf=r.json().csrf;
    assert.equal((await call('/studio/google/configure',config,{'x-hermo-csrf':'bad'})).statusCode,403);
    assert.equal((await call('/studio/google/configure',{...config,password:'wrong'})).statusCode,401);
    assert.equal((await call('/studio/google/configure',{...config,clientId:'attacker.example'})).statusCode,400);
    r=await call('/studio/google/configure',config);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().configured,true);assert.equal(r.body.includes(secret),false);
    const sealed=state.store.getSetting('google_oauth_client');assert.equal(sealed.includes(secret),false);assert.deepEqual(state.store.unseal(sealed),{clientId,clientSecret:secret});
    for(const path of ['/studio/session','/studio/overview','/studio/privacy-export','/studio/audit','/studio/google'])assert.equal((await call(path)).body.includes(secret),false);
    await state.app.close();state=await createApp({port:4337,dataDir});cookie='';r=await call('/studio/session');assert.equal(r.json().google.configured,true);assert.equal(r.json().google.clientSecret,undefined);
  }finally{await state.app.close();}
});
test('Google provider verifies signed identity, audience, expiry, nonce and verified email',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256'),wrong=await generateKeyPair('RS256');let token,exchangeBody;
  const provider=createGoogleProvider({clientId,clientSecret:'synthetic-secret',keyResolver:publicKey,fetchToken:async(url,options)=>{assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(options.redirect,'error');exchangeBody=options.body;return {ok:true,json:async()=>({id_token:token,access_token:'must-not-leak',refresh_token:'must-not-persist'})};}});
  const authorize=new URL(provider.authorization({redirectUri:'http://127.0.0.1:4318/oauth/google/callback',state:'test-state',nonce:'test-nonce',verifier:'test-verifier'}));
  assert.equal(authorize.origin,'https://accounts.google.com');assert.equal(authorize.searchParams.get('scope'),'openid email profile');assert.equal(authorize.searchParams.get('code_challenge'),createHash('sha256').update('test-verifier').digest('base64url'));assert.equal(authorize.searchParams.get('access_type'),'online');
  const sign=async(overrides={},key=privateKey)=>new SignJWT({sub:'123456789',nonce:'test-nonce',email:'synthetic@example.test',email_verified:true,name:'Synthetic Owner',...overrides}).setProtectedHeader({alg:'RS256'}).setIssuer(overrides.iss??'https://accounts.google.com').setAudience(overrides.aud??clientId).setIssuedAt().setExpirationTime(overrides.exp??'5m').sign(key);
  const input={code:'one-use-code',redirectUri:'http://127.0.0.1:4318/oauth/google/callback',nonce:'test-nonce',verifier:'test-verifier'};
  token=await sign();const identity=await provider.exchange(input);assert.deepEqual(identity,{sub:'123456789',email:'synthetic@example.test',name:'Synthetic Owner'});assert.equal(exchangeBody.get('code_verifier'),'test-verifier');assert.equal(JSON.stringify(identity).includes('token'),false);
  for(const claims of [{nonce:'wrong'},{email_verified:false},{aud:'other-client'},{iss:'https://attacker.example'},{exp:1},{azp:'other-client'},{sub:''}]){token=await sign(claims);await assert.rejects(()=>provider.exchange(input));}
  token=await sign({},wrong.privateKey);await assert.rejects(()=>provider.exchange(input));
});

test('Google linking and login bind state to browser, enforce owner consent, reject replay and revoke on unlink',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');const flows=new Map();let subject='owner-sub';
  const provider={configured:true,authorization(flow){flows.set(flow.state,flow);return 'https://accounts.google.com/o/oauth2/v2/auth?state='+flow.state;},async exchange({nonce,verifier}){assert.ok([...flows.values()].some(f=>f.nonce===nonce&&f.verifier===verifier));return {sub:subject,email:'synthetic@example.test',name:'Synthetic Owner'};}};
  const {app,origin,store}=await createApp({port:4335,dataDir:resolve('work/google-tests',randomBytes(6).toString('hex')),googleProvider:provider});const host=new URL(origin).host;
  let cookie='',csrf='';
  const call=async(url,body,extra={})=>{const r=await app.inject({method:body===undefined?'GET':'POST',url,headers:{host,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...extra},...body===undefined?{}:{payload:body}});return r;};
  const take=r=>{const raw=r.headers['set-cookie'];for(const value of raw?Array.isArray(raw)?raw:[raw]:[]){const name=value.split('=')[0];cookie=cookie.split('; ').filter(x=>x&&!x.startsWith(name+'=')).concat(value.split(';')[0]).join('; ');}};
  const start=async(purpose)=>{const r=await call('/studio/google/start',{purpose,...purpose==='link'?{password:'synthetic-google-owner-password'}:{}});assert.equal(r.statusCode,200,r.body);take(r);return new URL(r.json().authorization_url).searchParams.get('state');};
  const callback=state=>call('/oauth/google/callback?state='+state+'&code=synthetic-code',undefined,{'sec-fetch-site':'cross-site'});
  try{
    let r=await call('/studio/session');take(r);csrf=r.json().csrf;assert.deepEqual(r.json().google,{configured:true,linked:false});
    assert.equal((await call('/studio/google/start',{purpose:'link',password:'fake'})).statusCode,401);
    r=await call('/studio/setup',{password:'synthetic-google-owner-password'});take(r);csrf=r.json().csrf;
    assert.equal((await call('/studio/google/start',{purpose:'link',password:'wrong'})).statusCode,401);
    assert.equal((await call('/studio/google/start',{purpose:'link',password:'synthetic-google-owner-password'},{'x-hermo-csrf':'bad'})).statusCode,403);
    assert.equal((await call('/studio/google/start',{purpose:'login'},{host:'localhost:4335'})).statusCode,409);
    const state=await start('link');const validCookie=cookie;assert.ok(cookie.includes('hermo_owner_4335='));assert.ok(cookie.includes('hermo_google_flow_4335='));
    cookie=cookie.split('; ').filter(x=>!x.startsWith('hermo_google_flow_4335=')).join('; ');assert.equal((await callback(state)).statusCode,400);cookie=validCookie;
    r=await callback(state);assert.equal(r.statusCode,302,r.body);assert.equal(r.headers.location,'/#privacy');take(r);assert.equal((await callback(state)).statusCode,400);
    assert.equal(store.getSetting('google_owner').includes('synthetic@example.test'),false);r=await call('/studio/session');csrf=r.json().csrf;assert.equal(r.json().google.identity.email,'synthetic@example.test');
    r=await call('/studio/logout',{});take(r);r=await call('/studio/session');take(r);csrf=r.json().csrf;assert.equal(r.json().google.identity,undefined);
    const wrongState=await start('login');subject='other-sub';assert.equal((await callback(wrongState)).statusCode,403);subject='owner-sub';
    const loginState=await start('login');r=await callback(loginState);assert.equal(r.statusCode,302,r.body);take(r);r=await call('/studio/session');assert.equal(r.json().authenticated,true);csrf=r.json().csrf;
    assert.equal((await call('/studio/google/unlink',{password:'synthetic-google-owner-password'})).statusCode,200);assert.equal(store.getSetting('google_owner'),undefined);assert.equal((await call('/studio/overview')).statusCode,401);
    assert.equal((await call('/studio/session',undefined,{'sec-fetch-site':'cross-site'})).statusCode,403);
  }finally{await app.close();}
});
