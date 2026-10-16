import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {startRun,observeProgress,runError} from '../server/run-state.mjs';

test('connected mutations cannot claim retry safety through retrieval metadata',()=>{
  for(const op of ['click','fill','select','check']){
    const definition={effect:'retrieval',steps:[{op}]},payload={execution_mode:'connected_chrome'};
    startRun(payload,definition,new Date().toISOString());
    observeProgress(payload,definition,0,1,{phase:'issuing'});
    const error=runError(Error('TIMEOUT'),payload);
    assert.equal(error.retry_safe,false,op);
    assert.equal(error.code,'EXECUTION_OUTCOME_UNKNOWN',op);
  }
});

test('managed retrieval and non-mutating connected steps retain their execution semantics',()=>{
  for(const [mode,steps]of [['managed_local',[{op:'click'}]],['connected_chrome',[{op:'navigate'},{op:'wait_text'}]],['connected_chrome',[{op:'click',enabled:false}]]]){
    const definition={effect:'retrieval',steps},payload={execution_mode:mode};
    startRun(payload,definition,new Date().toISOString());
    observeProgress(payload,definition,0,steps.length,{phase:'issuing'});
    assert.equal(payload.submission_may_have_occurred,undefined);
    assert.equal(runError(Error('TIMEOUT'),payload).retry_safe,true);
  }
});

test('legacy published contracts expose actual browser effects without rewriting revisions',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4465,{app,store,origin}=await createApp({port,dataDir:resolve('work/security-effects',randomBytes(6).toString('hex')),browserEngineFactory:async()=>({closeAll:async()=>{},closeStudios:async()=>{}})});
  const headers={host:'127.0.0.1:'+port,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'};
  try{
    for(const mode of ['connected','isolated']){
      const when=new Date().toISOString(),cid='conn_'+mode,wid='wf_'+mode;
      const connection={url:origin+'/sandbox/effects',origins:[origin],access:'public',browser_mode:mode,identity:mode==='connected'?{kind:'selected_tab',origin}:{kind:'public_origin',origin}};
      store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,mode,connection.url,'connected',store.seal(connection),when);
      const definition={effect:'retrieval',steps:[{op:'click',selector:'#submit'}],inputs:{},outputs:[{name:'result',selector:'#result'}],verifiers:[]};
      definition.version=hash(JSON.stringify(definition));
      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,mode,'effects.'+mode,'published',definition.version,store.seal(definition),definition.version,when);
      const secret='hm_live_'+randomBytes(32).toString('base64url');
      store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_'+mode,mode,hash(secret),secret.slice(-6),wid,new Date(Date.now()+60000).toISOString(),null,when);
      const list=await app.inject({method:'POST',url:'/mcp',headers:{...headers,authorization:'Bearer '+secret},payload:{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}});
      assert.equal(list.statusCode,200);
      const action=list.json().result.tools.find(tool=>tool.name==='action_effects_'+mode);
      assert.equal(action.annotations.readOnlyHint,mode==='isolated');
      assert.equal(action.annotations.destructiveHint,mode==='connected');
      assert.equal(action.annotations.idempotentHint,mode==='isolated');
      const revision=store.db.prepare('SELECT * FROM workflow_revisions WHERE workflow_id=?').get(wid);
      const saved=store.unseal(revision.payload);
      const spec=(await createSpec(wid,saved,revision.version)).info.description;
      assert.equal(spec.startsWith('Verified retrieval action.'),mode==='isolated');
      assert.deepEqual(saved.definition,definition);
      assert.equal(saved.definition.effect,'retrieval');
      assert.equal(store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=?').get(wid).payload,revision.payload);
    }
  }finally{await app.close();}
  async function createSpec(wid,saved,version){
    const {workflowSpec}=await import('../server/api-spec.mjs');
    return workflowSpec({id:wid,name:wid,slug:wid,version,definition:saved.definition,connection_config:saved.connection_config},origin);
  }
});

test('draft editing derives connected effects from enabled operations',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4466,{app,store,origin}=await createApp({port,dataDir:resolve('work/security-effects',randomBytes(6).toString('hex')),browserEngineFactory:async()=>({closeAll:async()=>{},closeStudios:async()=>{}})});
  let cookie='',csrf='';
  const call=async(path,payload)=>{
    const response=await app.inject({method:payload===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,'x-hermo-csrf':csrf},...payload===undefined?{}:{payload}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];
    assert.equal(response.statusCode,200,response.body);return response.json();
  };
  try{
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-effects-owner-password'})).csrf;
    const when=new Date().toISOString(),connection={url:origin+'/sandbox/effects',origins:[origin],access:'public',browser_mode:'connected',identity:{kind:'selected_tab',origin}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_edit','Effects',connection.url,'connected',store.seal(connection),when);
    const original={effect:'retrieval',steps:[],inputs:{},outputs:[{name:'result',selector:'#result'}],verifiers:[],action_type:'custom'};
    original.version=hash(JSON.stringify(original));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_edit','conn_edit','Effects','effects.editor','draft',original.version,store.seal(original),null,when);
    for(const op of ['click','fill','select','check']){
      const current=(await call('/studio/workflows/wf_edit/editor')).definition;
      const saved=await call('/studio/workflows/wf_edit/editor',{expected_version:current.version,effect:'retrieval',steps:[{op,selector:'#control',...op==='click'?{}:{value:op==='check'?'true':'value'}}],inputs:{},outputs:original.outputs,verifiers:[],timeout_seconds:15});
      assert.equal(saved.definition.effect,'recorded_browser_actions',op);
    }
  }finally{await app.close();}
});
