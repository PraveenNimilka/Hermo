import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('consumer result polling has its own bounded allowance without raising run admission limits',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4416,{app,store}=await createApp({port,dataDir:resolve('work/consumer-polling',randomBytes(6).toString('hex'))});
  const {db,seal}=store,stamp=new Date().toISOString(),secret='hm_live_'+randomBytes(32).toString('base64url');
  const headers={host:'127.0.0.1:'+port,authorization:'Bearer '+secret};
  try{
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_poll','Saved weather','https://weather.example.test/','connected',seal({url:'https://weather.example.test/',origins:['https://weather.example.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://weather.example.test'}}),stamp);
    const definition={version:'fixture',timeout_ms:180000,inputs:{},outputs:[{name:'temperature',selector:'#temperature'}],steps:[],verifiers:[{kind:'number',output:'temperature'}],action_type:'read',effect:'retrieval'};
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_poll','conn_poll','Weather','weather.poll','published','fixture',seal(definition),'fixture',stamp);
    db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_poll','Polling client',hash(secret),'TEST00','wf_poll','2099-01-01T00:00:00.000Z',null,stamp);
    db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run_poll','wf_poll','key_poll','owned-request',hash('{}'),'succeeded',seal({input:{},result:{temperature:'28'},verification:{verified_at:stamp}}),stamp,stamp);
    for(let index=0;index<180;index++)assert.equal((await app.inject({method:'GET',url:'/v1/runs/run_poll',headers})).statusCode,200,'Three minutes of client polling must not consume admission allowance');
    for(let index=0;index<120;index++)assert.equal((await app.inject({method:'GET',url:'/v1/runs/run_poll',headers})).statusCode,200);
    const limited=await app.inject({method:'GET',url:'/v1/runs/run_poll',headers});assert.equal(limited.statusCode,429);assert.ok(Number(limited.headers['retry-after'])>0,'Polling remains bounded with a retry delay');
    const contract=await app.inject({method:'GET',url:'/v1/action-contract',headers});assert.equal(contract.statusCode,200);assert.equal(contract.json().timeout_seconds,180,'Client can use the action execution budget');
    for(let index=0;index<90;index++){
      const status=await app.inject({method:'POST',url:'/mcp',headers:{...headers,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'},payload:{jsonrpc:'2.0',id:index+1,method:'tools/call',params:{name:'get_run',arguments:{run_id:'run_poll'}}}});
      assert.equal(status.statusCode,200,'MCP status polling has a transport allowance independent of run admission');assert.equal(status.json().result.structuredContent.status,'succeeded');
    }
    for(let index=0;index<60;index++){
      const invalid=await app.inject({method:'POST',url:'/v1/actions/weather.poll/versions/1/runs',headers:{...headers,'idempotency-key':'invalid-'+index},payload:{input:{unknown:'value'}}});assert.equal(invalid.statusCode,400,'Invalid admissions still consume their own rate allowance');
    }
    assert.equal((await app.inject({method:'POST',url:'/v1/actions/weather.poll/versions/1/runs',headers:{...headers,'idempotency-key':'admission-limited'},payload:{input:{}}})).statusCode,429,'Run admission remains sixty requests per minute');
    const mcpAdmission=await app.inject({method:'POST',url:'/mcp',headers:{...headers,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'},payload:{jsonrpc:'2.0',id:999,method:'tools/call',params:{name:'action_weather_poll',arguments:{input:{},request_id:'mcp-admission-limited'}}}});
    assert.equal(mcpAdmission.statusCode,200);assert.equal(mcpAdmission.json().result.isError,true,'MCP action calls share the unchanged admission limit');assert.equal(db.prepare('SELECT count(*) n FROM runs').get().n,1,'Rate-limited admission never dispatches a website action');
    const denied=await app.inject({method:'GET',url:'/v1/runs/run_poll',headers:{host:headers.host}});assert.equal(denied.statusCode,401,'Polling still requires scoped authentication');
  }finally{await app.close();}
});

test('isolated retrieval mode explains why generation and submissions need the normal website tab',async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4417,{app,store}=await createApp({port,dataDir:resolve('work/isolated-task-guidance',randomBytes(6).toString('hex')),browserEngineFactory:async()=>({closeAll:async()=>{},closeStudios:async()=>{}})});
  let cookie='',csrf='';const call=async(path,body)=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];return response;};
  try{
    csrf=(await call('/studio/session')).json().csrf;csrf=(await call('/studio/setup',{password:'synthetic-task-mode-password'})).json().csrf;
    const stamp=new Date().toISOString();store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_mode','Saved public page','https://example.com/','connected',store.seal({url:'https://example.com/',origins:['https://example.com'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://example.com'}}),stamp);
    for(const type of ['generate_media','submit_form']){const response=await call('/studio/recordings',{connection_id:'conn_mode',name:'Website task',slug:'mode.'+type.replaceAll('_','-'),action_type:type});assert.equal(response.statusCode,409);assert.equal(response.json().error.code,'NORMAL_BROWSER_REQUIRED');assert.match(response.json().error.message,/normal Chrome/);}
    assert.equal(store.db.prepare('SELECT count(*) n FROM workflows').get().n,0,'Unsupported replay modes cannot produce a misleading draft');
  }finally{await app.close();}
});
