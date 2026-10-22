import {id} from './store.mjs';
import {existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {rm} from 'node:fs/promises';
import {z} from 'zod';

export function installBrowserWorkspaces(app,{store,dataDir,connection,saveConnection,fail,normalBrowserLauncher,closeConnection,recordings,removeProfile=rm}){
  const {db,seal,unseal,audit}=store,deleting=new Set();
  const list=()=>db.prepare('SELECT * FROM browser_workspaces ORDER BY created_at').all().map(row=>({...unseal(row.payload),id:row.id,created_at:row.created_at}));
  const get=bid=>{if(deleting.has(bid))fail('BROWSER_REMOVING','This saved browser is being deleted. Choose another browser.',409);const row=list().find(x=>x.id===bid);if(!row)fail('BROWSER_NOT_FOUND','This saved browser was removed. Choose another browser.',404);return row;};
  const safe=b=>({id:b.id,name:b.name,kind:b.kind,legacy:!!b.legacy,created_at:b.created_at,apps:db.prepare('SELECT * FROM connections').all().filter(c=>unseal(c.payload).browser_workspace_id===b.id).map(c=>({id:c.id,name:c.name}))});
  const create=(name,kind,extra={})=>{const bid=id('browser'),b={name,kind,...extra};db.prepare('INSERT INTO browser_workspaces VALUES (?,?,?)').run(bid,seal(b),new Date().toISOString());audit('browser.saved',bid);return get(bid);};
  const parse=(schema,body)=>{const r=schema.safeParse(body);if(!r.success)fail('INVALID_REQUEST','Check the saved browser fields.');return r.data;};
  if(!store.getSetting('browser_workspace_migration_v1')){
    db.exec('BEGIN IMMEDIATE');try{
      let current;
      for(const row of db.prepare('SELECT * FROM connections').all()){
        const c={...row,...unseal(row.payload)};if(c.browser_mode==='connected'&&!c.browser_workspace_id){current??=create('My Chrome browser','current');saveConnection(c,{browser_workspace_id:current.id});}
      }
      if(existsSync(resolve(dataDir,'normal-chrome')))create('Saved separate Chrome browser','managed',{legacy:true});
      store.setSetting('browser_workspace_migration_v1','1');db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  app.get('/studio/browser-workspaces',async()=>({browsers:list().map(safe),legacy_profiles:(store.getSetting('google_browser_profiles')?unseal(store.getSetting('google_browser_profiles')):[]).map(p=>({id:p.id,name:p.name,kind:'google_snapshot'}))}));
  app.post('/studio/browser-workspaces',async req=>{const body=parse(z.object({name:z.string().trim().min(1).max(100),kind:z.enum(['current','managed'])}).strict(),req.body);if(list().length>=20)fail('BROWSER_LIMIT','Up to twenty saved browsers are supported.');return {browser:safe(create(body.name,body.kind))};});
  app.post('/studio/browser-workspaces/:bid/rename',async req=>{const b=get(req.params.bid),body=parse(z.object({name:z.string().trim().min(1).max(100)}).strict(),req.body);db.prepare('UPDATE browser_workspaces SET payload=? WHERE id=?').run(seal({...b,name:body.name}),b.id);return {browser:safe(get(b.id))};});
  app.post('/studio/browser-workspaces/:bid/open',async req=>{
    const b=get(req.params.bid),body=parse(z.object({connection_id:z.string().optional()}).strict(),req.body);
    if(b.kind!=='managed')fail('USE_CURRENT_BROWSER','Open the saved app in your Chrome browser and click the Hermo companion.',409);
    const c=body.connection_id?connection(body.connection_id):undefined;if(c&&c.browser_workspace_id!==b.id)fail('WRONG_BROWSER','Choose an app saved in this browser.',409);
    try{await normalBrowserLauncher({workspace_id:b.id,legacy:b.legacy,url:c?.url??'https://www.google.com/'});}catch{fail('NORMAL_BROWSER_UNAVAILABLE','Chrome could not open. Check that Chrome is installed.',422);}return {ok:true};
  });
  app.post('/studio/browser-workspaces/:bid/reset-context',async req=>{
    const b=get(req.params.bid);parse(z.object({authorized:z.literal(true)}).strict(),req.body);const apps=safe(b).apps;
    for(const c of apps)if([...recordings.values()].some(r=>r.connectionId===c.id)||db.prepare("SELECT count(*) n FROM runs WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?) AND status IN ('queued','running','verifying')").get(c.id).n)fail('BROWSER_BUSY','Stop active apps before reconnecting this saved browser.',409);
    for(const c of apps){await closeConnection(c.id);saveConnection(connection(c.id),{},'stopped');}
    delete b.context_id;db.prepare('UPDATE browser_workspaces SET payload=? WHERE id=?').run(seal(b),b.id);audit('browser.context_reset',b.id);return {ok:true};
  });
  app.post('/studio/browser-workspaces/:bid/remove',async req=>{
    const b=get(req.params.bid),body=parse(z.object({authorized:z.literal(true),delete_profile:z.boolean().default(false),confirmation:z.string().optional()}).strict(),req.body);
    if(body.confirmation!==undefined&&body.confirmation!==`Delete "${b.name}"`)fail('CONFIRMATION_REQUIRED','Type the exact confirmation shown before deleting this browser.');
    if(safe(b).apps.length)fail('BROWSER_IN_USE','Delete the associated app connections before removing this saved browser.',409);
    deleting.add(b.id);try{
    if(body.delete_profile){
      if(b.kind!=='managed'||b.legacy)fail('PROFILE_DELETE_BLOCKED','This browser directory is preserved. Remove its saved entry only.',409);
      const base=resolve(dataDir,'browser-workspaces'),target=resolve(base,b.id);
      if(!/^browser_[a-f0-9]{24}$/.test(b.id)||!target.startsWith(base+sep))fail('PROFILE_DELETE_BLOCKED','The browser directory could not be validated.',409);
      try{await removeProfile(target,{recursive:true,force:true});}catch{fail('BROWSER_OPEN','Close this separate Chrome browser before deleting its local profile.',409);}
    }
    db.prepare('DELETE FROM browser_workspaces WHERE id=?').run(b.id);audit('browser.removed',b.id);return {ok:true};
    }finally{deleting.delete(b.id);}
  });
  return {get,list,safe,create,bind(bid,context,{connectionId,replace=false}={}){
    let b=get(bid);
    if(b.context_id&&b.context_id!==context){
      if(!replace||!connectionId)fail('WRONG_BROWSER','The companion identity changed. Create a fresh Connect code in Hermo, then connect this tab. Your actions and API keys stay saved.',409);
      const c=connection(connectionId);if(c.browser_workspace_id!==bid)fail('WRONG_BROWSER','The saved browser changed. Create a fresh Connect code.',409);
      // Owner-authorized recovery moves only this app. A shared browser's other
      // apps retain their original profile binding and live tab authorization.
      const matching=list().find(value=>value.kind==='current'&&value.context_id===context);
      const reuse=!matching&&b.kind==='current'&&safe(b).apps.length===1;
      if(!matching&&!reuse&&list().length>=20)fail('BROWSER_LIMIT','Remove an unused saved browser before reconnecting this app.',409);
      db.exec('BEGIN IMMEDIATE');try{
        b=matching??(reuse?b:create('Reconnected Chrome browser','current'));
        if(b.context_id!==context)db.prepare('UPDATE browser_workspaces SET payload=? WHERE id=?').run(seal({...b,context_id:context}),b.id);
        if(c.browser_workspace_id!==b.id)saveConnection(c,{browser_workspace_id:b.id});
        audit('browser.app_reconnected',c.id);db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return;
    }
    if(!b.context_id)db.prepare('UPDATE browser_workspaces SET payload=? WHERE id=?').run(seal({...b,context_id:context}),b.id);
  }};
}
