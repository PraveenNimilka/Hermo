import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {createBrowserEngine} from '../server/browser.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));

// Controlled Hermo-owned fixture faults, not evidence of external-site compatibility.
// Provisioning and execution use public owner/consumer HTTP routes; no database seeds.
test('managed Chromium crash, missing output, cancellation and timeout fail closed and recover',{timeout:100000},async t=>{
  const previousMasterKey=process.env.HERMO_MASTER_KEY;
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4468,dataDir=resolve('work/managed-faults',randomBytes(8).toString('hex'));
  const launched=[];
  let state,mode='ready',visits=0,cookie='',csrf='',key,workflow;
  const terminal=new Set(['succeeded','failed','cancelled']);
  const waitFor=async(check,{timeout=35000,message='Condition did not settle'}={})=>{
    const until=Date.now()+timeout;
    while(Date.now()<until){const value=await check();if(value)return value;await pause(100);}
    assert.fail(message);
  };
  try{
    state=await createApp({port,dataDir,browserEngineFactory:(proxy,origin,options)=>createBrowserEngine(proxy,origin,{
      ...options,
      launchBrowser:async options=>{const browser=await chromium.launch(options);launched.push(browser);return browser;}
    })});
    const {app,origin}=state;
    app.get('/sandbox/fault-data',async(_req,reply)=>{
      visits++;
      const delayed=mode==='delay',stalled=mode==='stall';
      const output=mode==='missing'?'':'<output id="answer">42</output>';
      return reply.header('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; connect-src 'self'")
        .type('text/html').send(`<!doctype html><html><head><title>Managed fault fixture</title></head><body><main><h1>Local catalog</h1>${output}<div id="ready"${delayed||stalled?' hidden':''}>Ready</div></main>${delayed?'<script>setTimeout(()=>document.querySelector("#ready").hidden=false,250)</script>':''}</body></html>`);
    });
    await app.listen({host:'127.0.0.1',port});
    const call=async(path,body,headers={})=>{
      const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...cookie?{cookie}:{},...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...headers},...body===undefined?{}:{body:JSON.stringify(body)}});
      const owner=response.headers.get('set-cookie');if(owner?.startsWith(`hermo_owner_${port}=`))cookie=owner.split(';')[0];
      const value=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(value)}`);return value;
    };
    const auth=()=>({authorization:'Bearer '+key});
    const read=rid=>call('/v1/runs/'+rid,undefined,auth());
    const finish=rid=>waitFor(async()=>{const run=await read(rid);return terminal.has(run.status)&&run;},{message:`Run ${rid} did not terminate`});
    const admission=idem=>call('/v1/actions/managed.faults/versions/1/runs',{input:{}},{...auth(),'idempotency-key':idem});
    const begin=async nextMode=>{
      mode=nextMode;visits=0;
      const requestId=randomBytes(12).toString('hex'),receipt=await admission(requestId);
      await waitFor(async()=>{const run=await read(receipt.run_id);return run.status==='running'&&run.current_step?.number===1&&visits===1;},{message:'Managed run did not reach its real DOM wait'});
      return {...receipt,request_id:requestId};
    };
    const recover=async()=>{
      mode='delay';visits=0;
      const receipt=await admission(randomBytes(12).toString('hex')),run=await finish(receipt.run_id);
      assert.equal(run.status,'succeeded',JSON.stringify(run));assert.deepEqual(run.result,{value:42});
      assert.equal(run.execution_mode,'managed_local');assert.equal(run.workflow_revision,1);assert.equal(run.outcome,'verified');
      assert.equal(visits,1,'recovery uses one fresh page navigation');assert.equal(run.steps[0].status,'succeeded');
      return run;
    };
    const failure=run=>{assert.equal(run.status,'failed',JSON.stringify(run));assert.equal(run.result,undefined);assert.equal(run.verification,undefined);assert.equal(run.outcome,'unverified');assert.equal(run.workflow_revision,1);};

    csrf=(await call('/studio/session')).csrf;
    csrf=(await call('/studio/setup',{password:'controlled-managed-fault-test-owner'})).csrf;
    const connection=(await call('/studio/connections',{name:'Controlled local catalog',url:origin+'/sandbox/fault-data',browser_mode:'isolated',access:'public',authorized:true})).connection;
    await call(`/studio/connections/${connection.id}/open`,{});
    await call(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    const recording=await call('/studio/recordings',{connection_id:connection.id,name:'Managed fault regression',slug:'managed.faults',action_type:'read_data'});
    const preview=await call(`/studio/connections/${connection.id}/browser`);
    const output=preview.elements.find(item=>item.kind==='output'&&item.preview==='42');assert.ok(output,'Output must be detected from the actual local DOM');
    await call(`/studio/recordings/${recording.id}/output`,{element_id:output.id,name:'value'});
    workflow=(await call(`/studio/recordings/${recording.id}/finish`,{verifiers:[{kind:'nonempty',output:'value'}],timeout_seconds:15})).workflow;
    const editor=await call(`/studio/workflows/${workflow.id}/editor`);
    await call(`/studio/workflows/${workflow.id}/editor`,{expected_version:editor.version,inputs:{},outputs:[{name:'value',selector:'#answer',type:'number'}],steps:[{op:'wait_element',selector:'#ready',state:'visible',timeout_ms:30000}],verifiers:[{kind:'nonempty',output:'value'}],timeout_seconds:15});
    const tested=await call(`/studio/workflows/${workflow.id}/test`,{input:{}});
    const verified=await waitFor(async()=>{const run=await call('/studio/runs/'+tested.run_id);return terminal.has(run.status)&&run;});
    assert.equal(verified.status,'succeeded',JSON.stringify(verified));assert.deepEqual(verified.result,{value:42});
    key=(await call(`/studio/workflows/${workflow.id}/publish`,{})).key;
    await call(`/studio/connections/${connection.id}/close`,{});

    await t.test('missing output never returns an old value or retries navigation',async()=>{
      mode='missing';visits=0;
      const receipt=await admission('missing-output'),run=await finish(receipt.run_id);failure(run);
      assert.equal(run.error.category,'OUTPUT_VALIDATION_FAILED');assert.equal(run.error.verification.reason,'missing_output');
      assert.equal(visits,1);assert.equal((await admission('missing-output')).run_id,receipt.run_id,'receipt recovery does not execute again');
      assert.equal(visits,1);await recover();
    });
    await t.test('active cancellation closes execution and a later request uses fresh state',async()=>{
      const receipt=await begin('stall');
      const cancelled=await call(`/v1/runs/${receipt.run_id}/cancel`,{},auth());assert.equal(cancelled.status,'cancelled');
      const run=await finish(receipt.run_id);assert.equal(run.error.code,'WORKFLOW_CANCELLED');assert.equal(run.result,undefined);assert.equal(run.steps[0].status,'cancelled');
      assert.equal(visits,1);await recover();
    });
    await t.test('configured workflow deadline yields a structured timeout without retry',async()=>{
      const receipt=await begin('stall'),run=await finish(receipt.run_id);failure(run);
      assert.equal(run.error.code,'WORKFLOW_TIMEOUT');assert.equal(run.error.category,'WORKFLOW_TIMEOUT');
      assert.equal(run.steps[0].status,'failed');assert.equal(visits,1);await recover();
    });
    await t.test('actual browser process crash fails the current run and launches a new browser only for new work',async()=>{
      const receipt=await begin('stall'),browser=launched.at(-1),before=launched.length;
      assert.equal(browser.isConnected(),true);
      const disconnected=new Promise(done=>browser.once('disconnected',done));
      const cdp=await browser.newBrowserCDPSession();
      const info=await cdp.send('SystemInfo.getProcessInfo');
      const browserProcess=info.processInfo.find(item=>item.type==='browser');
      assert.ok(Number.isSafeInteger(browserProcess?.id)&&browserProcess.id>0&&browserProcess.id!==process.pid,'CDP must identify this launched browser process');
      // Windows Browser.crash can wait on the crash reporter. Terminate only
      // the process identified by this disposable browser's own CDP session.
      process.kill(browserProcess.id,'SIGKILL');
      await Promise.race([disconnected,pause(5000).then(()=>assert.fail('Chromium did not crash'))]);
      assert.equal(browser.isConnected(),false,'the actual Chromium process must be gone');
      const run=await finish(receipt.run_id);failure(run);assert.equal(run.error.code,'BROWSER_DISCONNECTED');assert.equal(run.error.category,'BROWSER_DISCONNECTED');assert.match(run.error.message,/managed local browser disconnected/);
      assert.equal(visits,1);await pause(300);assert.equal(launched.length,before,'crashed work is not automatically relaunched');
      const duplicate=await admission(receipt.request_id);
      assert.equal(duplicate.run_id,receipt.run_id);assert.equal(duplicate.reused,true);
      assert.equal(launched.length,before,'recovering the original receipt never relaunches crashed work');
      // Only a separately admitted request may start the replacement browser.
      await recover();assert.equal(launched.length,before+1);
      assert.equal((await read(receipt.run_id)).status,'failed');
    });
  }finally{
    await state?.app.close();
    if(previousMasterKey===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMasterKey;
  }
});
