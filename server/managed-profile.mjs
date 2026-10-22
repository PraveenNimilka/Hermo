import {existsSync} from 'node:fs';
import {chromium} from 'playwright';
import {z} from 'zod';
import {id} from './store.mjs';

// Only trusted process configuration selects an executable. Owner HTTP requests
// cannot supply paths, profile directories or launch arguments.
export function managedBrowserInstallation(){
  const configured=process.env.HERMO_BROWSER_PATH;
  if(configured)return {executablePath:configured,available:existsSync(configured),source:'configured'};
  if(existsSync(chromium.executablePath()))return {executablePath:undefined,available:true,source:'bundled'};
  const executablePath=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
  return {executablePath,available:!!executablePath,source:executablePath?'system':'missing'};
}

export function installManagedProfiles(app,{store,connection,saveConnection,engine,assertConnectionIdle,isRecording,connectionBusy,invalidate,fail}){
  const changing=new Set();
  const managed=cid=>{const c=connection(cid);if(c.browser_mode==='connected')fail('MANAGED_BROWSER_REQUIRED','These settings belong to the isolated local browser. Selected Chrome tabs use their companion connection.',409);return c;};
  const describe=c=>{
    const {available,source}=managedBrowserInstallation();
    return {connection_id:c.id,name:c.name,storage:'encrypted_profile',session_saved:engine.hasDiskProfile?.(c.id)===true||!!(c.storageState?.cookies?.length||c.storageState?.origins?.length),identity_verified:!!c.identity&&c.status==='connected',
      visibility:c.managed_profile?.visibility??'headless',available:c.status==='connected',busy:changing.has(c.id)||connectionBusy(c.id)||isRecording(c.id)||engine.isProfileBusy?.(c.id)===true,
      capabilities:{persistent_profile_directory:true,network_policy:'workflow_defined'},browser:{available,source}};
  };
  async function change(cid,operation){
    const c=managed(cid);assertConnectionIdle(cid);
    if(isRecording(cid))fail('RECORDING_ACTIVE','Finish or discard the recording before changing this managed session.',409);
    if(changing.has(cid)||engine.isProfileBusy?.(cid))fail('BROWSER_BUSY','Finish the managed browser operation before changing its session.',409);
    // This barrier also guards admission and recording while context closure is
    // asynchronous. An accepted run must never race a session reset.
    changing.add(cid);
    try{await engine.close(cid);return operation(connection(cid));}
    finally{changing.delete(cid);}
  }
  app.get('/studio/connections/:cid/managed-profile',async req=>describe(managed(req.params.cid)));
  app.post('/studio/connections/:cid/managed-profile',async req=>{
    const parsed=z.object({visibility:z.enum(['headless','visible'])}).strict().safeParse(req.body);
    if(!parsed.success)fail('INVALID_REQUEST','Choose hidden or visible browser execution.');
    await change(req.params.cid,c=>{saveConnection(c,{managed_profile:{visibility:parsed.data.visibility}});store.audit('connection.managed_visibility_changed',c.id);});
    return describe(connection(req.params.cid));
  });
  app.post('/studio/connections/:cid/managed-profile/reset',async req=>{
    const c=managed(req.params.cid),parsed=z.object({confirmation:z.string().max(120)}).strict().safeParse(req.body);
    if(!parsed.success||parsed.data.confirmation!==`Reset "${c.name}"`)fail('CONFIRMATION_REQUIRED','Type the exact reset confirmation shown.');
    await change(c.id,current=>{
      store.db.exec('SAVEPOINT reset_managed_session');
      try{
        engine.forgetProfile?.(c.id);
        saveConnection(current,{storageState:undefined,studioState:undefined,checkpoint:undefined,identity:undefined,browser_profile_id:undefined,session_generation:id('session')},'auth_required');
        invalidate(c.id);store.audit('connection.managed_session_reset',c.id);store.db.exec('RELEASE reset_managed_session');
      }catch(error){store.db.exec('ROLLBACK TO reset_managed_session; RELEASE reset_managed_session');throw error;}
    });
    return {...describe(connection(c.id)),retest_required:true};
  });
  return {isChanging:cid=>changing.has(cid)};
}
