import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';

test('local project organization preserves resources and enforces owner and deletion boundaries',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4432,{app,store,origin}=await createApp({port,dataDir:resolve('work/projects',randomBytes(6).toString('hex'))});let cookie='',csrf='';
  const call=async(path,body,headers={})=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return {status:r.statusCode,value:r.json()};};
  const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.value;};
  try{
    assert.equal((await call('/studio/projects')).status,401);
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-project-fixture-owner'})).csrf;
    const created=(await ok('/studio/projects',{name:'Product intelligence'})).project;
    assert.equal((await call('/studio/projects',{name:'CSRF-blocked'},{'x-hermo-csrf':'wrong'})).status,403);
    const c=(await ok('/studio/connections',{name:'Catalog',url:origin+'/sandbox/',authorized:true,project_id:created.id})).connection;
    assert.equal(c.project_id,created.id);
    assert.equal((await ok('/studio/overview')).connections.length,0);
    assert.equal((await ok('/studio/overview?project_id='+created.id)).connections[0].id,c.id);
    assert.equal((await call(`/studio/projects/${created.id}/remove`,{confirmation:'Delete "Product intelligence"'})).value.error.code,'PROJECT_NOT_EMPTY');
    await ok(`/studio/projects/${created.id}/rename`,{name:'Research'});
    await ok(`/studio/connections/${c.id}/project`,{project_id:'project_personal'});
    assert.equal((await ok('/studio/overview')).connections[0].id,c.id);
    assert.equal((await call(`/studio/projects/${created.id}/remove`,{confirmation:'Delete "Product intelligence"'})).value.error.code,'CONFIRMATION_MISMATCH');
    await ok(`/studio/projects/${created.id}/remove`,{confirmation:'Delete "Research"'});
    assert.equal((await call('/studio/projects/project_personal/remove',{confirmation:'Delete "Personal workspace"'})).value.error.code,'DEFAULT_PROJECT');
    assert.ok(store.db.prepare('SELECT id FROM connections WHERE id=?').get(c.id));
  }finally{await app.close();}
});
