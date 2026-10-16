import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';

const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createGoogleProvider({clientId=process.env.HERMO_GOOGLE_CLIENT_ID,clientSecret=process.env.HERMO_GOOGLE_CLIENT_SECRET,keyResolver,fetchToken=fetch}={}){
  const configured=!!clientId&&!!clientSecret;
  if(configured&&!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId))throw new Error('Invalid Google OAuth client ID.');
  const keys=keyResolver??createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:8000});
  return {configured,clientId,
    authorization({redirectUri,state,nonce,verifier}){
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'online',prompt:'select_account'});
      return url.href;
    },
    async exchange({code,redirectUri,nonce,verifier}){
      const response=await fetchToken('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code',code_verifier:verifier})});
      if(!response.ok)throw new Error('GOOGLE_TOKEN_REJECTED');
      const tokens=await response.json();if(typeof tokens.id_token!=='string'||tokens.id_token.length>20000)throw new Error('GOOGLE_TOKEN_REJECTED');
      const {payload}=await jwtVerify(tokens.id_token,keys,{algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,requiredClaims:['exp','iat','sub','nonce','email','email_verified'],maxTokenAge:'10m',clockTolerance:5});
      if(!same(payload.nonce,nonce)||payload.email_verified!==true||typeof payload.sub!=='string'||!payload.sub.length||payload.sub.length>255||typeof payload.email!=='string'||payload.email.length>320||payload.azp&&payload.azp!==clientId)throw new Error('GOOGLE_IDENTITY_REJECTED');
      // Access/refresh/ID tokens are deliberately not persisted or exposed.
      return {sub:payload.sub,email:payload.email,name:typeof payload.name==='string'?payload.name.slice(0,100):''};
    }
  };
}

export function installGoogle(app,{origin,provider,ownerCookie,store,session,newSession,sessions,hash,passwordMatches,fail,rate}){
  let activeProvider=provider;
  const pending=new Map(),redirectUri=origin+'/oauth/google/callback',flowCookie='hermo_google_flow_'+new URL(origin).port;
  const linked=()=>{const value=store.getSetting('google_owner');return value?store.unseal(value):null;};
  const status=authenticated=>({configured:activeProvider.configured,linked:!!linked(),...authenticated?{redirect_uri:redirectUri,identity:linked()?{email:linked().email,name:linked().name}:null}:{}});
  const password=async value=>{rate('google-password',5,900000);const stored=store.getSetting('owner_password');if(typeof value!=='string'||value.length>128||!stored||!await passwordMatches(value,stored))fail('INVALID_CREDENTIALS','Confirm your workspace password.',401);};
  app.get('/studio/google',async()=>status(true));
  app.post('/studio/google/configure',async(req)=>{
    const body=req.body;
    if(!body||Object.keys(body).length!==3||typeof body.clientId!=='string'||body.clientId.length>200||!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(body.clientId)||typeof body.clientSecret!=='string'||body.clientSecret.length<8||body.clientSecret.length>512||/[\r\n\0]/.test(body.clientSecret))fail('INVALID_REQUEST','Enter a valid Google Web application client ID and secret, and confirm your workspace password.');
    await password(body.password);
    const config={clientId:body.clientId,clientSecret:body.clientSecret};activeProvider=createGoogleProvider(config);
    store.setSetting('google_oauth_client',store.seal(config));pending.clear();for(const [key,value]of sessions)if(value.method==='google')sessions.delete(key);
    store.audit('workspace.google_configured');return status(true);
  });
  app.post('/studio/google/start',async(req,reply)=>{
    rate('google-start',10,600000);
    if(req.headers.host!==new URL(origin).host)fail('CANONICAL_ORIGIN_REQUIRED','Open Hermo at '+origin+' before starting Google sign-in.',409);
    if(!activeProvider.configured)fail('GOOGLE_NOT_CONFIGURED','Configure your Google Cloud client before using Google sign-in.',409);
    const body=req.body;if(!body||!['link','login'].includes(body.purpose)||Object.keys(body).some(k=>!['purpose','password'].includes(k)))fail('INVALID_REQUEST','Choose Google login or account linking.');
    if(body.purpose==='link'){if(!session(req)?.authenticated)fail('UNAUTHORIZED','Unlock your workspace before linking Google.',401);await password(body.password);}
    else if(!linked())fail('GOOGLE_NOT_LINKED','Link your Google account in Privacy first.',409);
    for(const [key,item]of pending)if(item.expires<Date.now())pending.delete(key);
    if(pending.size>=20)fail('RATE_LIMITED','Complete or wait for an existing Google sign-in.',429);
    const state=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    pending.set(hash(state),{purpose:body.purpose,binding:hash(binding),nonce,verifier,expires:Date.now()+300000,owner:hash(req.cookies[ownerCookie]??''),subject:linked()?.sub});
    reply.setCookie(flowCookie,binding,{httpOnly:true,sameSite:'lax',path:'/oauth/google/',maxAge:300});
    return {authorization_url:activeProvider.authorization({redirectUri,state,nonce,verifier})};
  });
  app.get('/oauth/google/callback',async(req,reply)=>{
    const state=req.query.state,item=typeof state==='string'&&state.length<=100?pending.get(hash(state)):null;
    if(!item||item.expires<Date.now()||!same(item.binding,hash(req.cookies[flowCookie]??'')))fail('GOOGLE_STATE_REJECTED','This sign-in expired or belongs to another browser. Start again.',400);
    pending.delete(hash(state));reply.clearCookie(flowCookie,{path:'/oauth/google/'});
    if(req.query.error)return reply.redirect('/?google=cancelled');
    if(typeof req.query.code!=='string'||!req.query.code.length||req.query.code.length>4096)fail('GOOGLE_TOKEN_REJECTED','Google did not return a valid authorization code.',400);
    if(item.purpose==='link'&&(!sessions.get(item.owner)?.authenticated||sessions.get(item.owner).expires<Date.now()))fail('UNAUTHORIZED','Unlock your workspace and start linking again.',401);
    let identity;try{identity=await activeProvider.exchange({code:req.query.code,redirectUri,nonce:item.nonce,verifier:item.verifier});}catch{fail('GOOGLE_TOKEN_REJECTED','Google sign-in could not be verified. Start again in your normal Chrome or Edge browser.',401);}
    if(item.purpose==='login'&&(!same(item.subject,linked()?.sub)||!same(identity.sub,linked()?.sub)))fail('GOOGLE_ACCOUNT_MISMATCH','Use the Google account linked to this workspace.',403);
    if(item.purpose==='link'){store.setSetting('google_owner',store.seal(identity));for(const [key,value]of sessions)if(value.method==='google')sessions.delete(key);store.audit('workspace.google_linked');}
    sessions.delete(item.owner);const next=newSession(reply,true);next.method='google';
    store.audit('workspace.google_unlocked');return reply.redirect(item.purpose==='link'?'/#privacy':'/');
  });
  app.post('/studio/google/unlink',async(req)=>{
    if(!req.body||Object.keys(req.body).length!==1)fail('INVALID_REQUEST','Confirm your password to unlink Google.');await password(req.body.password);
    store.db.prepare("DELETE FROM settings WHERE key='google_owner'").run();pending.clear();for(const [key,value]of sessions)if(value.method==='google')sessions.delete(key);store.audit('workspace.google_unlinked');return {ok:true};
  });
  app.addHook('onClose',async()=>pending.clear());
  return {status,forget(owner){for(const [key,item]of pending)if(item.owner===owner)pending.delete(key);}};
}
