import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {openStore} from '../server/store.mjs';
import {installBrowserWorkspaces} from '../server/browser-workspaces.mjs';
import {createApp} from '../server/index.mjs';

test('saved-browser physical removal blocks new binding until completion and releases lock on failure',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const directory=resolve('work/browser-removal-race',randomBytes(6).toString('hex')),store=openStore(directory),routes=new Map();
  let release,started=false;
  const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{publicCode:code,statusCode:status});};
  const app={get:(path,fn)=>routes.set(path,fn),post:(path,fn)=>routes.set(path,fn)};
  const browsers=installBrowserWorkspaces(app,{store,dataDir:directory,fail,recordings:new Map(),closeConnection:async()=>{},normalBrowserLauncher:async()=>{},removeProfile:async target=>{assert.ok(target.startsWith(resolve(directory,'browser-workspaces')));started=true;return new Promise((done,reject)=>{release=reject;});}});
  try{
    const selected=browsers.create('My separate browser','managed'),other=browsers.create('Other browser','current');
    const remove=routes.get('/studio/browser-workspaces/:bid/remove');
    await assert.rejects(remove({params:{bid:selected.id},body:{authorized:true,confirmation:'Delete "Wrong browser"'}}),e=>e.publicCode==='CONFIRMATION_REQUIRED');
    const pending=remove({params:{bid:selected.id},body:{authorized:true,delete_profile:true,confirmation:'Delete "My separate browser"'}});
    assert.equal(started,true);
    for(const operation of [()=>browsers.get(selected.id),()=>browsers.bind(selected.id,'bc_'+randomBytes(18).toString('hex'))])assert.throws(operation,e=>e.publicCode==='BROWSER_REMOVING');
    assert.equal(browsers.get(other.id).name,'Other browser');
    release(Error('Synthetic open profile'));
    await assert.rejects(pending,e=>e.publicCode==='BROWSER_OPEN');
    assert.equal(browsers.get(selected.id).name,'My separate browser','failed removal releases the transient lock and keeps data');
    await remove({params:{bid:selected.id},body:{authorized:true,confirmation:'Delete "My separate browser"'}});
    assert.throws(()=>browsers.get(selected.id),e=>e.publicCode==='BROWSER_NOT_FOUND');
    assert.equal(browsers.get(other.id).name,'Other browser');
  }finally{store.close();}
});

test('account confirmation pins the selected text and rejects messages while retaining old owner requests',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  let text='Current account',eligible=true;
  const port=4402,origin=`http://127.0.0.1:${port}`;
  const engine={isOpen:()=>true,open:async()=>{},close:async()=>{},closeAll:async()=>{},closeStudios:async()=>{},snapshot:async()=>({url:origin+'/sandbox/profile',can_confirm:true}),element:()=>({selector:'#account',frame_path:[],identity_eligible:eligible}),read:async()=>text,save:async()=>({checkpoint:origin+'/sandbox/profile'})};
  const {app,store}=await createApp({port,dataDir:resolve('work/account-confirm-race',randomBytes(6).toString('hex')),browserEngineFactory:async()=>engine});
  const connection=cid=>{const row=store.db.prepare('SELECT * FROM connections WHERE id=?').get(cid);return {...row,...store.unseal(row.payload)};};
  let cookie='',csrf='';
  const call=async(url,body)=>{
    const r=await app.inject({method:body===undefined?'GET':'POST',url,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});
    if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return r;
  };
  const ok=async(...args)=>{const r=await call(...args);assert.ok(r.statusCode<300,r.body);return r.json();};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-confirmation-owner'})).csrf;
    const c=(await ok('/studio/connections',{name:'Profile fixture',url:origin+'/sandbox/profile',authorized:true})).connection;
    const path=`/studio/connections/${c.id}/confirm`;
    assert.equal((await call(path,{element_id:'marker',expected_text:'Previously selected account'})).json().error.code,'ACCOUNT_CHANGED');
    assert.equal(connection(c.id).status,'auth_required');assert.equal(connection(c.id).identity,undefined);
    await ok(path,{element_id:'marker',expected_text:text});assert.equal(connection(c.id).identity.text,text);
    eligible=false;text='An ordinary conversation message';
    assert.equal((await call(path,{element_id:'marker',expected_text:text})).json().error.code,'INVALID_ACCOUNT_MARKER');
    assert.equal(connection(c.id).identity.text,'Current account');
    eligible=true;text='Legacy owner account';await ok(path,{element_id:'marker'});assert.equal(connection(c.id).identity.text,text);
  }finally{await app.close();}
});
