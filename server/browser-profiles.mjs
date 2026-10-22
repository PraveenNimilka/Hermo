import {id} from './store.mjs';
import {publicAddress} from './network.mjs';

export const googleBrowserOrigins=Object.freeze(['https://accounts.google.com','https://myaccount.google.com','https://www.google.com','https://www.gstatic.com','https://ssl.gstatic.com','https://fonts.googleapis.com','https://fonts.gstatic.com','https://lh3.googleusercontent.com']);
const googlePages=new Set(['accounts.google.com','myaccount.google.com']);
const domainMatches=(domain,hostname)=>domain.startsWith('.')?hostname===domain.slice(1)||hostname.endsWith(domain):hostname===domain;
export function filterProfileState(state,origins=googleBrowserOrigins){
  const hosts=origins.map(x=>new URL(x).hostname),allowed=new Set(origins);
  return {cookies:(state?.cookies??[]).filter(c=>hosts.some(h=>domainMatches(c.domain,h))),origins:(state?.origins??[]).filter(x=>allowed.has(x.origin))};
}
export function mergeProfileState(existing,profile){
  const key=c=>JSON.stringify([c.domain,c.path,c.name,c.partitionKey??null]);
  return {cookies:[...new Map([...(existing?.cookies??[]),...profile.cookies].map(c=>[key(c),c])).values()],origins:[...new Map([...(existing?.origins??[]),...profile.origins].map(o=>[o.origin,o])).values()]};
}
export function installBrowserProfiles(app,{store,engine,connection,recordings,fail,rate,saveConnection,invalidate,assertConnectionIdle=()=>{},assertConnectionCurrent=()=>{}}){
  const profiles=()=>{const value=store.getSetting('google_browser_profiles');return value?store.unseal(value):[];};
  const metadata=p=>({id:p.id,name:p.name,connection_id:p.connection_id,saved_at:p.saved_at,source:p.source??'private_browser',origins:googleBrowserOrigins});
  const get=pid=>{const p=profiles().find(x=>x.id===pid);if(!p)fail('PROFILE_NOT_FOUND','This browser sign-in was removed. Save a new one.',404);return p;};
  const inactive=cid=>{assertConnectionIdle(cid);if([...recordings.values()].some(r=>r.connectionId===cid))fail('RECORDING_ACTIVE','Finish or discard the recording before changing browser sign-in.',409);};
  const apply=async(c,pid)=>{
    if(c.access==='public')fail('PUBLIC_PROFILE_BLOCKED','Public sources always use an anonymous browser.',400);
    const p=get(pid);inactive(c.id);
    const origins=[...new Set([...c.origins,...googleBrowserOrigins])];if(origins.length>32)fail('ORIGIN_LIMIT','Up to 32 exact origins are supported per connection.');
    try{for(const value of googleBrowserOrigins)await publicAddress(new URL(value).hostname);}catch{fail('INVALID_ORIGIN','A Google service could not be resolved to a public address. Retry after checking your network.');}
    inactive(c.id);
    const previous=c.studioState?.storageState??c.storageState;
    saveConnection(c,{origins,browser_profile_id:p.id,studioState:{storageState:mergeProfileState(previous,p.storageState),checkpoint:c.url}},'auth_required');
    invalidate(c.id);await engine.close(c.id);store.audit('connection.browser_profile_applied',c.id);
    return {ok:true,retest_required:true};
  };
  app.get('/studio/browser-profiles',async()=>({profiles:profiles().map(metadata),google_origins:googleBrowserOrigins}));
  app.post('/studio/browser-profiles',async req=>{
    rate('browser-profile-save',10,600000);const b=req.body;
    if(!b||Object.keys(b).some(k=>!['connection_id','element_id','name'].includes(k))||typeof b.connection_id!=='string'||typeof b.element_id!=='string'||typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>80)fail('INVALID_REQUEST','Choose a name and the signed-in Google email marker.');
    const c=connection(b.connection_id);inactive(c.id);if(c.access==='public')fail('PUBLIC_PROFILE_BLOCKED','Public sources cannot save sign-ins.');
    const snapshot=await engine.snapshot(c.id);if(!snapshot.can_confirm||!googlePages.has(new URL(snapshot.url).hostname))fail('GOOGLE_BROWSER_NOT_READY','Open Google account settings in this private browser, finish sign-in and resolve verification first.',409);
    let marker;try{const item=engine.element(c.id,b.element_id,'output');if(item.frame_path?.length)throw Error('Use top-level account marker');marker=await engine.read(c.id,item);}catch{fail('IDENTITY_UNAVAILABLE','Select your visible Google email address.',422);}
    if(!/^[^\s@<>]{1,150}@[^\s@<>]{1,150}\.[^\s@<>]{1,30}$/.test(marker))fail('IDENTITY_UNAVAILABLE','Select only your Google email address as the account marker.',422);
    const saved=await engine.save(c.id),storageState=filterProfileState(saved.storageState);
    if(!googlePages.has(new URL(saved.checkpoint).hostname)||!storageState.cookies.length)fail('GOOGLE_BROWSER_NOT_READY','No Google browser session is available to save.',409);
    if(Buffer.byteLength(JSON.stringify(storageState))>2*1024*1024)fail('PROFILE_TOO_LARGE','This browser session exceeds the private sign-in storage limit.',413);
    const all=profiles(),existing=all.find(p=>p.connection_id===c.id);if(!existing&&all.length>=5)fail('PROFILE_LIMIT','Remove a saved browser sign-in before creating another.',409);
    const p={id:existing?.id??id('profile'),name:b.name.trim(),connection_id:c.id,saved_at:new Date().toISOString(),storageState};
    inactive(c.id);assertConnectionCurrent(c);
    store.setSetting('google_browser_profiles',store.seal([...all.filter(x=>x.id!==p.id),p]));
    // The draft browser session is separate from the confirmed API account.
    // Saving it never silently changes cookies used by a published action.
    const checkpoint=new URL(saved.checkpoint);checkpoint.search='';checkpoint.hash='';
    saveConnection(c,{studioState:{storageState:saved.storageState,checkpoint:checkpoint.href},browser_profile_id:p.id});
    store.audit('browser_profile.saved',p.id);return {profile:metadata(p)};
  });
  app.post('/studio/connections/:cid/browser-profile',async req=>{
    const b=req.body;if(!b||Object.keys(b).length!==2||typeof b.profile_id!=='string'||b.authorized!==true)fail('INVALID_REQUEST','Explicitly authorize using this Google browser sign-in.');
    return apply(connection(req.params.cid),b.profile_id);
  });
  app.post('/studio/connections/:cid/google-sign-in',async req=>{
    const b=req.body;if(!b||Object.keys(b).length)fail('INVALID_REQUEST','No sign-in parameters are accepted.');
    const c=connection(req.params.cid);inactive(c.id);if(c.access==='public')fail('PUBLIC_PROFILE_BLOCKED','Public sources always use an anonymous browser.');
    if(!googleBrowserOrigins.every(x=>c.origins.includes(x)))fail('ORIGIN_NOT_APPROVED','Review and allow Google sign-in services first.',409);
    await engine.open(c.id,c,{resume:true});await engine.addTab(c.id,'https://accounts.google.com/');return {ok:true};
  });
  app.post('/studio/browser-profiles/:pid/revoke',async req=>{
    if(!req.body||Object.keys(req.body).length)fail('INVALID_REQUEST','No revocation parameters are accepted.');
    const p=get(req.params.pid),affected=store.db.prepare('SELECT id FROM connections').all().map(x=>connection(x.id)).filter(c=>c.browser_profile_id===p.id);
    // Check all active recordings before making any changes.
    for(const c of affected)inactive(c.id);
    store.setSetting('google_browser_profiles',store.seal(profiles().filter(x=>x.id!==p.id)));
    for(const c of affected){await engine.close(c.id);saveConnection(connection(c.id),{studioState:undefined,storageState:undefined,identity:undefined,checkpoint:undefined,browser_profile_id:undefined,session_generation:id('session')},'auth_required');invalidate(c.id);}
    store.audit('browser_profile.revoked',p.id);return {ok:true,affected_connections:affected.length};
  });
  return {get,apply};
}
