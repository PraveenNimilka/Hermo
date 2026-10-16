import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';

test('anonymous session issuance is bounded without locking out an existing owner',async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4467,{app}=await createApp({port,dataDir:resolve('work/security-sessions',randomBytes(6).toString('hex')),browserEngineFactory:async()=>({closeAll:async()=>{},closeStudios:async()=>{}})});
  const headers={host:`127.0.0.1:${port}`};
  try{
    const initial=await app.inject({url:'/studio/session',headers});
    const anonymous=initial.headers['set-cookie'].split(';')[0],csrf=initial.json().csrf;
    const setup=await app.inject({method:'POST',url:'/studio/setup',headers:{...headers,cookie:anonymous,'x-hermo-csrf':csrf},payload:{password:'synthetic-session-budget-password'}});
    assert.equal(setup.statusCode,200);
    const owner=setup.headers['set-cookie'].split(';')[0];
    let clock=Date.now();t.mock.method(Date,'now',()=>clock);
    let oldest,recent;
    for(let n=0;n<119;n++){
      const response=await app.inject({url:'/studio/session',headers});
      assert.equal(response.statusCode,200);
      if(!oldest)oldest={cookie:response.headers['set-cookie'].split(';')[0],csrf:response.json().csrf};
    }
    const denied=await app.inject({url:'/studio/session',headers});
    assert.equal(denied.statusCode,429);assert.equal(denied.json().error.code,'RATE_LIMITED');
    assert.ok(Number(denied.headers['retry-after'])>0);
    assert.equal(denied.headers['set-cookie'],undefined);
    const active=await app.inject({url:'/studio/session',headers:{...headers,cookie:owner}});
    assert.equal(active.statusCode,200);assert.equal(active.json().authenticated,true);
    assert.equal(active.headers['set-cookie'],undefined);
    assert.equal((await app.inject({url:'/studio/overview',headers:{...headers,cookie:owner}})).statusCode,200);
    clock+=60001;
    for(let n=0;n<20;n++){
      const response=await app.inject({url:'/studio/session',headers});
      assert.equal(response.statusCode,200);recent=response.headers['set-cookie'].split(';')[0];
    }
    const evicted=await app.inject({url:'/studio/session',headers:{...headers,cookie:oldest.cookie}});
    assert.equal(evicted.statusCode,200);assert.notEqual(evicted.json().csrf,oldest.csrf);
    assert.ok(evicted.headers['set-cookie'],'oldest anonymous session was evicted at capacity');
    assert.equal((await app.inject({url:'/studio/session',headers:{...headers,cookie:recent}})).headers['set-cookie'],undefined);
    assert.equal((await app.inject({url:'/studio/session',headers:{...headers,cookie:owner}})).json().authenticated,true);
  }finally{await app.close();}
});
