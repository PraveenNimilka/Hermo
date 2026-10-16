import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {hash,id,passwordMatches} from './store.mjs';
import {googleBrowserOrigins,filterProfileState} from './browser-profiles.mjs';

const extensionOrigin=value=>typeof value==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(value);
export function isCompanionRequest(req,path){
  if(path!=='/companion/google/import')return false;
  if(req.method==='OPTIONS')return extensionOrigin(req.headers.origin);
  const identifier=req.headers['x-hermo-extension-id'];
  return req.method==='POST'&&typeof identifier==='string'&&/^[a-p]{32}$/.test(identifier)&&(!req.headers.origin||req.headers.origin==='chrome-extension://'+identifier)&&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='none'||extensionOrigin(req.headers.origin));
}
const clean=z.string().refine(v=>!/[\x00-\x1f\x7f]/.test(v));
const cookieSchema=z.object({name:clean.pipe(z.string().min(1).max(128)),value:clean.pipe(z.string().max(4096)),domain:z.string().min(1).max(255),path:clean.pipe(z.string().startsWith('/').max(256)),expires:z.number().finite().min(-1).max(4102444800),httpOnly:z.boolean(),secure:z.boolean(),sameSite:z.enum(['Strict','Lax','None'])}).strict();
export function validateGoogleCookies(value){
  const result=z.array(cookieSchema).min(1).max(100).safeParse(value);if(!result.success)throw Error('INVALID_GOOGLE_COOKIES');
  const kept=filterProfileState({cookies:result.data,origins:[]}).cookies;
  if(kept.length!==result.data.length||kept.some(c=>c.expires!==-1&&c.expires<=Date.now()/1000))throw Error('INVALID_GOOGLE_COOKIES');
  if(kept.some(c=>c.name.startsWith('__Secure-')&&!c.secure||c.name.startsWith('__Host-')&&(!c.secure||c.path!=='/'||c.domain.startsWith('.'))||c.sameSite==='None'&&!c.secure))throw Error('INVALID_GOOGLE_COOKIES');
  if(!kept.some(c=>['SID','__Secure-1PSID','__Secure-3PSID'].includes(c.name)&&c.value))throw Error('GOOGLE_SIGN_IN_REQUIRED');
  if(new Set(kept.map(c=>JSON.stringify([c.domain,c.path,c.name]))).size!==kept.length)throw Error('INVALID_GOOGLE_COOKIES');
  return kept;
}
export function installGoogleCompanion(app,{origin,store,sessions,ownerCookie,session,fail,rate,normalBrowserLauncher}){
  const grants=new Map();
  const paths=()=>({workspace_origin:origin,extension_directory:resolve(dirname(fileURLToPath(import.meta.url)),'../companion/chrome'),guide_url:origin+'/normal-chrome.html'});
  app.post('/studio/browser-profiles/normal-chrome',async req=>{
    rate('normal-chrome-import-start',5,900000);
    const parsed=z.object({name:z.string().trim().min(1).max(80),authorized:z.literal(true),password:z.string().min(1).max(128)}).strict().safeParse(req.body);
    if(!parsed.success)fail('INVALID_REQUEST','Confirm your workspace password and authorize the Google session transfer.');
    if(!await passwordMatches(parsed.data.password,store.getSetting('owner_password')))fail('INVALID_CREDENTIALS','The workspace password is incorrect.',401);
    const all=store.getSetting('google_browser_profiles');if(all&&store.unseal(all).length>=5)fail('PROFILE_LIMIT','Remove a saved browser sign-in before importing another.',409);
    const owner=hash(req.cookies[ownerCookie]??'');if(!session(req)?.authenticated)fail('UNAUTHORIZED','Unlock your workspace.',401);
    for(const [key,g]of grants)if(g.expires<Date.now()||g.owner===owner)grants.delete(key);
    try{await normalBrowserLauncher();}catch{fail('NORMAL_BROWSER_UNAVAILABLE','Normal Chrome could not open. Check that Chrome or Edge is installed.',422);}
    const code='hi_import_'+randomBytes(32).toString('base64url'),expires=Date.now()+10*60000;
    grants.set(hash(code),{owner,name:parsed.data.name,expires});store.audit('browser_profile.normal_chrome_started');
    return {code,expires_at:new Date(expires).toISOString(),...paths()};
  });
  app.options('/companion/google/import',async(req,reply)=>{
    if(!isCompanionRequest(req,'/companion/google/import'))fail('ORIGIN_BLOCKED','Only the local Chrome companion can use this endpoint.',403);
    reply.header('Access-Control-Allow-Origin',req.headers.origin).header('Vary','Origin').header('Access-Control-Allow-Methods','POST').header('Access-Control-Allow-Headers','authorization, content-type, x-hermo-extension-id');return reply.code(204).send();
  });
  app.post('/companion/google/import',{bodyLimit:131072},async(req,reply)=>{
    if(!isCompanionRequest(req,'/companion/google/import'))fail('ORIGIN_BLOCKED','Only the local Chrome companion can use this endpoint.',403);
    rate('normal-chrome-import',10,60000);
    const code=req.headers.authorization?.match(/^Bearer (hi_import_[A-Za-z0-9_-]{43})$/)?.[1],grant=code&&grants.get(hash(code)),owner=grant&&sessions.get(grant.owner);
    if(!grant||grant.expires<Date.now()||!owner?.authenticated||owner.expires<Date.now())fail('IMPORT_EXPIRED','The import code expired or the workspace was locked. Generate a new code.',401);
    if(!req.body||Object.keys(req.body).length!==2||req.body.authorized!==true||!Array.isArray(req.body.cookies))fail('INVALID_REQUEST','Explicit Google session transfer authorization is required.');
    let cookies;try{cookies=validateGoogleCookies(req.body.cookies);}catch(e){fail(e.message,e.message==='GOOGLE_SIGN_IN_REQUIRED'?'Sign in to Google in normal Chrome first.':'The Google session transfer was not accepted.');}
    const value=store.getSetting('google_browser_profiles'),all=value?store.unseal(value):[];if(all.length>=5)fail('PROFILE_LIMIT','Remove a saved browser sign-in before importing another.',409);
    const cid=id('conn'),profile={id:id('profile'),name:grant.name,connection_id:cid,saved_at:new Date().toISOString(),source:'normal_chrome_cookies',storageState:{cookies,origins:[]}};
    const payload={url:'https://myaccount.google.com/',origins:googleBrowserOrigins,access:'account',browser_profile_id:profile.id,studioState:{storageState:profile.storageState,checkpoint:'https://myaccount.google.com/'}};
    store.db.exec('BEGIN IMMEDIATE');try{store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Google · '+grant.name,payload.url,'auth_required',store.seal(payload),profile.saved_at);store.setSetting('google_browser_profiles',store.seal([...all,profile]));store.audit('browser_profile.normal_chrome_imported',profile.id);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
    grants.delete(hash(code));
    if(req.headers.origin)reply.header('Access-Control-Allow-Origin',req.headers.origin).header('Vary','Origin');
    return {ok:true,profile_id:profile.id};
  });
  app.addHook('onClose',async()=>grants.clear());
}
