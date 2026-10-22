import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';
import {mediaOutputError} from '../server/output-mappings.mjs';
import {hash} from '../server/store.mjs';

test('media generation requires an asset URL while retaining captions and nested contracts',()=>{
  const caption={name:'image_url',selector:'img',read_attribute:'alt'};
  assert.ok(mediaOutputError({action_type:'generate_media',outputs:[caption]}));
  assert.ok(mediaOutputError({action_type:'generate_media',outputs:[null]}));
  assert.ok(mediaOutputError({action_type:'generate_media',outputs:{}}));
  assert.equal(mediaOutputError({action_type:'custom',outputs:[caption]}),undefined);
  const url={name:'asset',selector:'img',read_attribute:'src',type:'url'};
  assert.equal(mediaOutputError({action_type:'generate_media',outputs:[caption,url]}),undefined);
  assert.equal(mediaOutputError({action_type:'generate_media',outputs:[{name:'images',type:'array',selector:'.result',items:{type:'url',selector:'img',read_attribute:'src'}}]}),undefined);
});

test('generated image recording, verification and scoped API calls return fresh URLs through Chrome',{timeout:90000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const {app,origin,store}=await createApp({port,dataDir:resolve('work/media-generation',randomUUID())});
  let cookie='',csrf='',closed=false,loop,browser,site,transportError;
  app.get('/sandbox/media-demo',async(_,reply)=>reply.header('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; connect-src 'self' blob:; script-src 'self'").type('text/html').send('<!doctype html><title>Generated image fixture</title><label>Prompt<input aria-label="Ask ChatGPT"></label><button aria-label="Send">Send</button><main><div data-testid="generated-image-preview"><img width="240" height="160" src="/sandbox/media-0.svg" alt="Generated image"></div></main><script src="/sandbox/media-demo.js"></script>'));
  app.get('/sandbox/media-demo.js',async(_,reply)=>reply.type('text/javascript').send('globalThis.submissions=0;document.querySelector("button").onclick=()=>{const n=++globalThis.submissions;setTimeout(()=>{document.querySelector("main").innerHTML=`<div data-testid="generated-image-preview"><img width="240" height="160" src="/sandbox/media-${n}.svg" alt="Generated image"></div>`;},120);};'));
  app.get('/sandbox/media-:n.svg',async(_,reply)=>reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160"/></svg>'));
  async function call(path,body,headers={}){
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  }
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const finish=async id=>{const deadline=Date.now()+20000;while(Date.now()<deadline){if(transportError)throw transportError;const run=await ok('/studio/runs/'+id);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(done=>setTimeout(done,50));}assert.fail('Media execution did not finish');};
  try{
    await app.listen({host:'127.0.0.1',port});csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-media-fixture-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Image fixture',url:origin+'/sandbox/media-demo',access:'public',browser_mode:'connected',authorized:true})).connection;
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    site=await browser.newPage();await site.goto(connection.url);
    const chrome={tabs:{get:async()=>({url:site.url(),status:'complete',windowId:1})},scripting:{executeScript:async({func,args=[]})=>[{result:await site.evaluate(func,args[0])}]}};
    const extension={'x-hermo-extension-id':'a'.repeat(32),origin:'chrome-extension://'+'a'.repeat(32),cookie:''};
    const grant=await ok(`/studio/connections/${connection.id}/browser-link`,{authorized:true});
    const paired=await ok('/companion/browser/pair',{code:grant.code,origin,authorized:true,protocol:2,context_id:'bc_'+randomUUID(),tab_id:1,capabilities:['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs','semantic_target_guard','completion_evidence','local_media']},extension);
    const companion={...extension,authorization:'Bearer '+paired.token};
    // Real Chrome DOM commands over the authenticated companion transport; the
    // local fixture reproduces generated-image-preview markup, not ChatGPT's service.
    loop=(async()=>{while(!closed){const message=await ok('/companion/browser/poll',{},companion);if(message.type==='closed')break;if(message.type!=='command')continue;let value,error;
      try{value=await executeBrowserCommand({chrome,tabId:1,origin,pathPrefix:'/sandbox/',command:message.command,inspect:inspectDocument,deadline:message.expires_at,beforeMutation:()=>ok('/companion/browser/authorize',{id:message.id},companion)});}catch(problem){error=['ELEMENT_CHANGED','ACTION_UNAVAILABLE','LOGIN_REQUIRED','ORIGIN_CHANGED'].includes(problem.message)?problem.message:'PAGE_READ_FAILED';}
      await ok('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}},companion);
    }})().catch(error=>{if(!closed)transportError=error;});
    const snap=()=>ok(`/studio/connections/${connection.id}/browser`);
    let view=await snap();const caption=view.elements.find(item=>item.read_attribute==='alt'),url=view.elements.find(item=>item.type==='image_url');
    assert.ok(caption&&url);assert.equal(caption.media_source_id,url.media_source_id);assert.equal(url.read_mode,'last');
    const bad=(await ok('/studio/recordings',{connection_id:connection.id,name:'Caption mistake',slug:'caption.mistake',action_type:'generate_media'})).id;
    await ok(`/studio/recordings/${bad}/output`,{element_id:caption.id,name:'image_url'});
    const rejected=await call(`/studio/recordings/${bad}/finish`,{verifiers:[{kind:'url',output:'image_url'}]});assert.equal(rejected.value.error.code,'MEDIA_OUTPUT_REQUIRED');assert.equal(await site.evaluate(()=>globalThis.submissions),0);
    await ok(`/studio/recordings/${bad}/discard`,{});
    const recording=(await ok('/studio/recordings',{connection_id:connection.id,name:'Image generation',slug:'image.generate',action_type:'generate_media'})).id;
    view=await snap();const input=view.elements.find(item=>item.kind==='input'),button=view.elements.find(item=>item.kind==='button');
    await ok(`/studio/connections/${connection.id}/control`,{recording_id:recording,element_id:input.id,kind:'fill',value:'A red bicycle',parameter:'prompt'});
    await ok(`/studio/connections/${connection.id}/control`,{recording_id:recording,element_id:button.id,kind:'click'});
    await site.waitForFunction(()=>document.querySelector('img').src.includes('media-1.svg'));
    view=await snap();await ok(`/studio/recordings/${recording}/output`,{element_id:view.elements.find(item=>item.type==='image_url').id,name:'image_url'});
    const workflow=(await ok(`/studio/recordings/${recording}/finish`,{verifiers:[{kind:'url',output:'image_url'}],timeout_seconds:300})).workflow;
    assert.equal(workflow.outputs[0].read_attribute,'src');
    const tested=await finish((await ok(`/studio/workflows/${workflow.id}/test`,{input:{prompt:'A new bicycle'}})).run_id);
    assert.equal(tested.status,'succeeded',JSON.stringify(tested));assert.equal(tested.result.image_url,origin+'/sandbox/media-2.svg');assert.equal(await site.evaluate(()=>globalThis.submissions),2);
    const review=await ok(`/studio/workflows/${workflow.id}/permissions`);
    const issued=await ok(`/studio/workflows/${workflow.id}/publish`,{permission_fingerprint:review.fingerprint,expected_version:workflow.version});
    const auth={authorization:'Bearer '+issued.key,'idempotency-key':'fresh-image'};
    const apiRun=await ok('/v1/actions/image.generate/versions/1/runs',{input:{prompt:'Another bicycle'}},auth),result=await finish(apiRun.run_id);
    assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.result.image_url,origin+'/sandbox/media-3.svg');
    const repeated=await ok('/v1/actions/image.generate/versions/1/runs',{input:{prompt:'Another bicycle'}},auth);assert.equal(repeated.run_id,apiRun.run_id);assert.equal(await site.evaluate(()=>globalThis.submissions),3);
    await site.evaluate(()=>{document.querySelector('button').onclick=()=>{globalThis.submissions++;const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;canvas.getContext('2d').fillRect(0,0,240,160);canvas.toBlob(blob=>{document.querySelector('main').innerHTML=`<div data-testid="generated-image-preview"><img width="240" height="160" src="${URL.createObjectURL(blob)}" alt="Generated image"></div>`;},'image/png');};});
    const local=await finish((await ok('/v1/actions/image.generate/versions/1/runs',{input:{prompt:'Local image'}},{...auth,'idempotency-key':'local-image'})).run_id);
    assert.equal(local.status,'succeeded',JSON.stringify(local));assert.ok(local.execution_ms<8000,'a loaded fresh image completes promptly, not at its timeout');
    const assetURL=new URL(local.result.image_url);assert.match(assetURL.pathname,/^\/media\/assets\/[A-Za-z0-9_-]{43}$/);
    const asset=await app.inject({method:'GET',url:assetURL.pathname,headers:{host:`127.0.0.1:${port}`,origin:'http://127.0.0.1:9999'}});
    assert.equal(asset.statusCode,200);assert.equal(asset.headers['content-type'],'image/png');assert.equal(asset.headers['access-control-allow-origin'],'*');assert.equal(asset.rawPayload[0],137);
    assert.equal((await app.inject({method:'GET',url:'/media/assets/'+'a'.repeat(43),headers:{host:`127.0.0.1:${port}`}})).statusCode,404);
    await site.evaluate(()=>{document.querySelector('button').onclick=()=>++globalThis.submissions;});
    const unchangedId=(await ok('/v1/actions/image.generate/versions/1/runs',{input:{prompt:'No fresh image'}},{...auth,'idempotency-key':'unchanged-image'})).run_id;
    for(let n=0;n<80;n++){if((await ok('/studio/runs/'+unchangedId)).phase==='verifying')break;await new Promise(done=>setTimeout(done,50));}
    await new Promise(done=>setTimeout(done,1500));assert.equal((await ok('/studio/runs/'+unchangedId)).status,'verifying','an unchanged image cannot complete verification');
    const unchanged=await ok('/studio/runs/'+unchangedId+'/cancel',{});
    assert.equal(unchanged.status,'cancelled');assert.equal(unchanged.result,undefined,'the old image must not be returned as a new generation');assert.equal(unchanged.error.code,'EXECUTION_OUTCOME_UNKNOWN');assert.equal(await site.evaluate(()=>globalThis.submissions),5,'an uncertain submission is never automatically repeated');
    const encrypted=store.db.prepare('SELECT * FROM media_assets WHERE run_id=?').get(local.id);assert.ok(encrypted);assert.notEqual(encrypted.token_hash,assetURL.pathname.split('/').at(-1));assert.equal(encrypted.payload.includes('image/png'),false,'asset bytes and metadata are encrypted');
    store.db.prepare('UPDATE media_assets SET expires_at=0 WHERE run_id=?').run(local.id);assert.equal((await app.inject({method:'GET',url:assetURL.pathname,headers:{host:`127.0.0.1:${port}`}})).statusCode,404,'expired links cannot download images');store.db.prepare('UPDATE media_assets SET expires_at=? WHERE run_id=?').run(Date.now()+60000,local.id);
    const keyId=store.db.prepare('SELECT id FROM api_keys WHERE hash=?').get(hash(issued.key)).id;
    store.db.prepare('UPDATE api_keys SET revoked_at=? WHERE id=?').run(new Date().toISOString(),keyId);
    assert.equal((await app.inject({method:'GET',url:assetURL.pathname,headers:{host:`127.0.0.1:${port}`}})).statusCode,404,'revoking the issuing API key revokes its asset links');
    // Old persisted drafts must be rejected before an accepted run or submission.
    const definition={...store.unseal(store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(workflow.id).payload),outputs:[{name:'image_url',selector:'img',read_attribute:'alt'}]};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('UPDATE workflows SET payload=?,version=?,status=? WHERE id=?').run(store.seal(definition),definition.version,'draft',workflow.id);
    const before=store.db.prepare('SELECT count(*) n FROM runs').get().n;
    const invalid=await call(`/studio/workflows/${workflow.id}/test`,{input:{prompt:'Do not submit'}});assert.equal(invalid.status,409);assert.equal(invalid.value.error.code,'MEDIA_OUTPUT_REQUIRED');assert.equal(store.db.prepare('SELECT count(*) n FROM runs').get().n,before);assert.equal(await site.evaluate(()=>globalThis.submissions),5);
    store.db.prepare('DELETE FROM runs WHERE id=?').run(local.id);assert.equal(store.db.prepare('SELECT count(*) n FROM media_assets WHERE run_id=?').get(local.id).n,0,'run deletion cascades its captured images');
  }catch(error){if(site)console.log('Fixture media state: '+JSON.stringify(await site.evaluate(()=>[...document.images].map(image=>({source:image.src.slice(0,80),complete:image.complete,width:image.naturalWidth,box:image.getBoundingClientRect().width,main:document.querySelector('main').innerHTML.slice(0,200)})))));throw error;}finally{closed=true;await app.close();await loop;await browser?.close();}
});
