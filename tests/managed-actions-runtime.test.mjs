import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';
import {openStore} from '../server/store.mjs';
import {createApp} from '../server/index.mjs';

test('real managed POST, PATCH and sockets verify current outputs; retrieval and foreign origins stay blocked',{timeout:120000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/managed-actions',randomBytes(8).toString('hex')),store=openStore(dataDir);
  let submissions=0,sockets=0,profilePath,engine,proxy;
  const server=createServer(async(req,res)=>{
    if(req.url==='/sandbox/action'&&['POST','PATCH'].includes(req.method)){
      submissions++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result:req.method+' confirmed '+submissions}));return;
    }
    res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><html><body><h1 id="identity">Synthetic owner</h1><div id="result">Pending</div>
      <button id="post" onclick="submit('POST')">Submit</button><button id="patch" onclick="submit('PATCH')">Update</button>
      <button id="socket" onclick="const s=new WebSocket('ws://'+location.host+'/sandbox/socket');s.onmessage=e=>document.querySelector('#result').textContent=e.data">Socket</button>
      <button id="foreign" onclick="fetch('https://unauthorized.invalid/submit',{method:'POST'}).catch(()=>document.querySelector('#result').textContent='Blocked')">Foreign</button>
      <script>async function submit(method){const r=await fetch('/sandbox/action',{method,body:'synthetic'});document.querySelector('#result').textContent=(await r.json()).result;}</script></body></html>`);
  });
  const openSockets=new Set();
  server.on('upgrade',(req,socket)=>{
    openSockets.add(socket);socket.on('close',()=>openSockets.delete(socket));socket.on('error',()=>{});
    if(req.url!=='/sandbox/socket'){socket.destroy();return;}
    sockets++;const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const payload=Buffer.from('Socket confirmed '+sockets);socket.write(Buffer.concat([Buffer.from([0x81,payload.length]),payload]));
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
  const connection={id:'conn_actions',url:origin+'/sandbox/',origins:[origin],access:'account',identity:{selector:'#identity',text:'Synthetic owner'}};
  const definition=selector=>({effect:'recorded_browser_actions',steps:[{op:'click',selector}],inputs:{},outputs:[{name:'response',selector:'#result',type:'string'}],verifiers:[{kind:'changed',output:'response'}],timeout_ms:8000});
  try{
    proxy=await createEgressProxy(origin);
    const make=()=>createBrowserEngine(proxy,origin,{dataDir,store,launchPersistentContext:async(directory,options)=>{profilePath=directory;assert.equal(options.offline,true);const ctx=await chromium.launchPersistentContext(directory,options);ctx.on('page',page=>page.on('console',message=>{if(message.type()==='error')console.log('Synthetic page diagnostic: '+message.text());}));return ctx;}});
    engine=await make();let studio=await engine.open(connection.id,connection);
    await studio.ctx.addCookies([{name:'session_only',value:'profile-session-secret',url:origin+'/sandbox/'}]);
    await studio.page.evaluate(async()=>{localStorage.setItem('fixture','retained');const cache=await caches.open('fixture');await cache.put('/sandbox/cached',new Response('disk-cache-secret'));});
    writeFileSync(join(profilePath,'hermo-disk-marker'),'disk-state-beyond-storageState');
    await engine.close(connection.id);
    assert.deepEqual(readdirSync(join(dataDir,'managed-profile-active')),[]);
    await engine.closeAll();engine=await make();studio=await engine.open(connection.id,connection);
    assert.equal(readFileSync(join(profilePath,'hermo-disk-marker'),'utf8'),'disk-state-beyond-storageState');
    assert.equal(await studio.page.evaluate(()=>localStorage.getItem('fixture')),'retained');
    assert.equal(await studio.page.evaluate(async()=>await (await (await caches.open('fixture')).match('/sandbox/cached')).text()),'disk-cache-secret');
    assert.ok((await studio.ctx.cookies()).some(cookie=>cookie.name==='session_only'&&cookie.value==='profile-session-secret'));
    for(const [selector,prefix]of [['#post','POST confirmed'],['#patch','PATCH confirmed'],['#socket','Socket confirmed']]){
      let result;try{result=await engine.execute(connection,definition(selector),{});}catch(error){error.message=selector+': '+error.message+' (submissions='+submissions+', sockets='+sockets+')';throw error;}assert.ok(result.result.response.startsWith(prefix),JSON.stringify(result));
    }
    assert.equal(submissions,2);assert.equal(sockets,1);
    const foreign=await engine.execute(connection,definition('#foreign'),{});assert.equal(foreign.result.response,'Blocked');
    for(const selector of ['#post','#socket']){
      await assert.rejects(engine.execute(connection,{...definition(selector),effect:'retrieval',timeout_ms:1800},{}));
    }
    assert.equal(submissions,2,'retrieval cannot submit');assert.equal(sockets,1,'retrieval cannot open a socket');
    studio=await engine.open(connection.id,connection);
    await studio.page.evaluate(()=>localStorage.setItem('fixture','uncommitted crash change'));
    const browser=studio.ctx.browser(),cdp=await browser.newBrowserCDPSession();
    const info=await cdp.send('SystemInfo.getProcessInfo'),processInfo=info.processInfo.find(item=>item.type==='browser');
    assert.ok(Number.isSafeInteger(processInfo?.id)&&processInfo.id>0&&processInfo.id!==process.pid);
    const disconnected=new Promise(done=>browser.once('disconnected',done));process.kill(processInfo.id,'SIGKILL');await disconnected;
    await engine.closeAll();engine=await make();studio=await engine.open(connection.id,connection);
    assert.equal(await studio.page.evaluate(()=>localStorage.getItem('fixture')),'retained','crash recovery uses the last complete encrypted snapshot');
    assert.equal(submissions,2,'crash recovery never repeats a submission');
    await engine.closeAll();engine=undefined;
    for(const file of ['hermo.sqlite','hermo.sqlite-wal']){try{const bytes=readFileSync(join(dataDir,file));for(const secret of ['disk-cache-secret','profile-session-secret'])assert.equal(bytes.includes(Buffer.from(secret)),false);}catch(error){if(error.code!=='ENOENT')throw error;}}
  }finally{
    await engine?.closeAll();await proxy?.close();for(const socket of openSockets)socket.destroy();await new Promise(done=>server.close(done));store.close();
    if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;
  }
});

test('managed form recording publishes reviewed submission permissions and invokes once through REST and MCP',{timeout:60000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));
  let state,cookie='',csrf='',submissions=0;
  const call=async(path,body,headers={})=>{
    const response=await fetch(state.origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...headers},...body===undefined?{}:{body:JSON.stringify(body)}});
    const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
  };
  const finish=async(id,headers={})=>{
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){const run=await call('/v1/runs/'+id,undefined,headers);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(done=>setTimeout(done,75));}assert.fail('Managed API invocation exceeded test deadline');
  };
  try{
    state=await createApp({port,dataDir:resolve('work/managed-action-api',randomBytes(8).toString('hex'))});
    state.app.get('/sandbox/submission',async(_req,reply)=>reply.type('text/html').send('<!doctype html><html><body><h1>Synthetic submission test</h1><label for="message">Message</label><input id="message"><button id="submit">Submit synthetic form</button><p id="response">Pending</p><script src="/sandbox/submission.js"></script></body></html>'));
    state.app.get('/sandbox/submission.js',async(_req,reply)=>reply.type('application/javascript').send('document.querySelector("#submit").addEventListener("click",async()=>{const r=await fetch("/sandbox/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:document.querySelector("#message").value})});document.querySelector("#response").textContent=(await r.json()).result})'));
    state.app.post('/sandbox/submit',async req=>({result:req.body.message+' confirmed '+(++submissions)}));
    await state.app.listen({host:'127.0.0.1',port});
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-managed-api-owner'})).csrf;
    const c=(await call('/studio/connections',{name:'Managed form',url:state.origin+'/sandbox/submission',browser_mode:'isolated',access:'public',authorized:true})).connection,base='/studio/connections/'+c.id;
    await call(base+'/open',{});await call(base+'/confirm',{public_source:true});
    const rec=await call('/studio/recordings',{connection_id:c.id,name:'Managed submit',slug:'managed.submit',action_type:'submit_form'});
    let view=await call(base+'/browser');
    const input=view.elements.find(item=>item.label==='Message');assert.ok(input);
    await call(base+'/control',{recording_id:rec.id,element_id:input.id,kind:'fill',value:'demo',parameter:'message'});
    view=await call(base+'/browser');const submit=view.elements.find(item=>item.label==='Submit synthetic form');assert.ok(submit);
    await call(base+'/control',{recording_id:rec.id,element_id:submit.id,kind:'click'});
    let output;
    for(let i=0;i<40&&!output;i++){view=await call(base+'/browser');output=view.elements.find(item=>item.kind==='output'&&item.preview==='demo confirmed 1');if(!output)await new Promise(done=>setTimeout(done,75));}
    assert.ok(output,JSON.stringify({submissions,elements:view.elements.map(item=>({kind:item.kind,label:item.label,preview:item.preview}))}));await call('/studio/recordings/'+rec.id+'/output',{element_id:output.id,name:'response'});
    const workflow=(await call('/studio/recordings/'+rec.id+'/finish',{verifiers:[{kind:'changed',output:'response'}],timeout_seconds:15})).workflow;
    assert.equal(workflow.effect,'recorded_browser_actions');
    const tested=await call('/studio/workflows/'+workflow.id+'/test',{input:{message:'owner'}});
    // Owner and consumer status access are intentionally separate.
    let ownerRun;for(let i=0;i<200;i++){ownerRun=await call('/studio/runs/'+tested.run_id);if(['succeeded','failed'].includes(ownerRun.status))break;await new Promise(done=>setTimeout(done,75));}
    assert.equal(ownerRun.status,'succeeded',JSON.stringify(ownerRun));
    const review=await call('/studio/workflows/'+workflow.id+'/permissions');assert.equal(review.network_interactions.restriction,'authorized_origins_http_and_wss');
    const publication=await call('/studio/workflows/'+workflow.id+'/publish',{expected_version:review.version,permission_fingerprint:review.fingerprint}),auth={authorization:'Bearer '+publication.key};
    const endpoint='/v1/actions/managed.submit/versions/1/runs',headers={...auth,'idempotency-key':'one-submission'},payload={input:{message:'rest'}};
    const admitted=await call(endpoint,payload,headers),run=await finish(admitted.run_id,auth);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.match(run.result.response,/^rest confirmed /);
    const count=submissions,reused=await call(endpoint,payload,headers);assert.equal(reused.run_id,admitted.run_id);assert.equal(submissions,count);
    const mcp=await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'action_managed_submit',arguments:{input:{message:'mcp'},request_id:'mcp-submission'}}},{...auth,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'});
    const final=await finish(mcp.result.structuredContent.run_id,auth);assert.equal(final.status,'succeeded',JSON.stringify(final));assert.match(final.result.response,/^mcp confirmed /);assert.equal(submissions,count+1);
  }finally{await state?.app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
