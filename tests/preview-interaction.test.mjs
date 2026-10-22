import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';

test('live preview operates recorded controls, scrolls nested content, and contains long outputs',{timeout:120000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/preview-interaction',randomUUID());mkdirSync(directory,{recursive:true});
  const {app,origin}=await createApp({port,dataDir:directory});let browser,site,ui,closed=false,loop,cookie='',csrf='';
  const longText='A long response that must remain inside its own output card. '.repeat(20),longURL='https://example.com/image?token='+'abcdef1234567890'.repeat(25);
  app.get('/sandbox/preview-demo',async(_,reply)=>reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><title>Preview fixture</title><style>body{margin:0;padding:24px;font:16px sans-serif}#pane{height:220px;width:500px;overflow:auto;border:1px solid}#inside{height:1600px}#long{position:absolute;left:600px;top:0;width:250px;height:650px;overflow:auto}p{overflow-wrap:anywhere}</style><button id="go">Generate result</button><label>Prompt<input id="prompt"></label><output id="answer">0</output><div id="pane"><div id="inside">Nested website scrolling</div></div><img id="generated" width="240" height="160" src="/sandbox/preview-art.svg" alt="Example generated artwork"><div id="long">${Array.from({length:10},(_,i)=>`<p id="value${i}">${i%2?longURL:longText}</p>`).join('')}</div><script src="/sandbox/preview-demo.js"></script>`));
  app.get('/sandbox/preview-art.svg',async(_,reply)=>reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160"/></svg>'));
  app.get('/sandbox/preview-demo.js',async(_,reply)=>reply.type('text/javascript').send("globalThis.submissions=0;document.querySelector('#go').onclick=()=>{document.querySelector('#answer').textContent=String(++globalThis.submissions);};"));
  async function call(path,body,headers={}){
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  }
  const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.value;};
  try{
    await app.listen({port,host:'127.0.0.1'});csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-preview-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Preview browser',url:origin+'/sandbox/preview-demo',access:'public',browser_mode:'connected',authorized:true})).connection;
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const siteContext=await browser.newContext({viewport:{width:900,height:700}});site=await siteContext.newPage();await site.goto(connection.url);
    // The transport adapter executes the real serialized companion functions in
    // Chrome. Frames use real page pixels; this does not claim tabCapture coverage.
    const chrome={tabs:{get:async()=>({url:site.url(),status:'complete',windowId:1})},scripting:{executeScript:async({func,args=[]})=>[{result:await site.evaluate(func,args[0])}]}};
    const grant=await ok(`/studio/connections/${connection.id}/browser-link`,{authorized:true});
    const extension={'x-hermo-extension-id':'a'.repeat(32),origin:'chrome-extension://'+'a'.repeat(32),cookie:''};
    const paired=await ok('/companion/browser/pair',{code:grant.code,origin,authorized:true,protocol:2,context_id:'bc_'+randomUUID(),tab_id:1,capabilities:['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs','live_preview','semantic_target_guard','completion_evidence','preview_interaction']},extension);
    const companion={...extension,authorization:'Bearer '+paired.token};
    loop=(async()=>{while(!closed){const message=await ok('/companion/browser/poll',{},companion);if(message.type==='closed')break;if(message.type!=='command')continue;let value,error;
      try{value=await executeBrowserCommand({chrome,tabId:1,origin,pathPrefix:'/sandbox/',command:message.command,inspect:inspectDocument,deadline:message.expires_at,beforeMutation:()=>ok('/companion/browser/authorize',{id:message.id},companion),getVisualFrame:async()=>({state:'live',image:(await site.screenshot({type:'jpeg'})).toString('base64'),captured_at:Date.now(),width:900,height:700})});}catch(problem){error=['ELEMENT_CHANGED','ACTION_UNAVAILABLE','LOGIN_REQUIRED','ORIGIN_CHANGED'].includes(problem.message)?problem.message:'PAGE_READ_FAILED';}
      await ok('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}},companion);
    }})();
    const snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);
    const point=async selector=>{const b=await site.locator(selector).boundingBox();assert.ok(b);return {x:(b.x+b.width/2)/900,y:(b.y+b.height/2)/700};};
    let snap=await snapshot();assert.ok(snap.preview.interaction_id);
    await t.test('preview endpoint requires owner authentication and rejects invalid points',async()=>{
      const body={frame_id:snap.preview.interaction_id,...await point('#go')};
      assert.equal((await call(`/studio/connections/${connection.id}/preview-target`,body,{cookie:''})).status,401);
      assert.equal((await call(`/studio/connections/${connection.id}/preview-target`,body,{'x-hermo-csrf':'wrong'})).status,403);
      assert.equal((await call(`/studio/connections/${connection.id}/preview-target`,{...body,x:2})).status,400);
    });
    await t.test('changed or expired preview targets never click a replacement',async()=>{
      const body={frame_id:snap.preview.interaction_id,...await point('#go')},picked=await ok(`/studio/connections/${connection.id}/preview-target`,body);
      await site.locator('#go').evaluate(node=>{node.textContent='Delete result';});
      assert.equal((await call(`/studio/connections/${connection.id}/control`,{element_id:picked.element_id,kind:'click',preview_guard:picked.guard})).status,422);
      assert.equal(await site.evaluate(()=>globalThis.submissions),0);
      await site.locator('#go').evaluate(node=>{node.textContent='Generate result';});
      await site.evaluate(id=>{globalThis[Symbol.for('hermo.preview.targets.v1')].get(id).at=Date.now()-6000;},body.frame_id);
      assert.equal((await call(`/studio/connections/${connection.id}/preview-target`,body)).value.error.code,'PREVIEW_CHANGED');
    });
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    ui=await context.newPage();ui.setDefaultTimeout(12000);const errors=[];ui.on('pageerror',error=>errors.push(error.message));
    await ui.goto(origin+'/#actions');await ui.getByRole('button',{name:'Create action',exact:true}).click();await ui.getByLabel('Connected app',{exact:true}).selectOption(connection.id);await ui.getByLabel('What should this action do?').selectOption('custom');await ui.getByLabel('Action name',{exact:true}).fill('Preview recording');await ui.getByLabel('API action ID').fill('preview.recording');await ui.getByRole('button',{name:'Start demonstration'}).click();
    const surface=ui.getByRole('button',{name:'Interact with connected website',exact:true});await surface.waitFor();
    await ui.waitForFunction(()=>document.querySelector('.connected-preview-surface')?.getAttribute('aria-disabled')==='false');
    await t.test('a pointer click performs one real website action and records it',async()=>{
      const p=await point('#go'),b=await surface.boundingBox();await surface.click({position:{x:p.x*b.width,y:p.y*b.height}});
      await site.waitForFunction(()=>globalThis.submissions===1);await ui.locator('.browser-busy').waitFor({state:'hidden'});
      const p2=await point('#prompt'),b2=await surface.boundingBox();await surface.click({position:{x:p2.x*b2.width,y:p2.y*b2.height}});
      await ui.getByLabel('Prompt',{exact:true}).waitFor();await ui.getByLabel('Prompt',{exact:true}).fill('Dynamic preview input');await ui.getByRole('button',{name:'Fill field',exact:true}).click();
      await site.waitForFunction(()=>document.querySelector('#prompt').value==='Dynamic preview input');await ui.locator('.browser-busy').waitFor({state:'hidden'});
    });
    await t.test('wheel input scrolls the nested website pane rather than the dashboard',async()=>{
      const p=await point('#pane'),b=await surface.boundingBox();await ui.mouse.move(b.x+p.x*b.width,b.y+p.y*b.height);await ui.mouse.wheel(0,300);
      await site.waitForFunction(()=>document.querySelector('#pane').scrollTop>0);assert.equal(await site.evaluate(()=>scrollY),0);await ui.locator('.browser-busy').waitFor({state:'hidden'});
    });
    await t.test('long text and URL cards never overlap at desktop or mobile widths',async()=>{
      await ui.getByRole('button',{name:'Outputs',exact:true}).click();await ui.locator('.output-choice').first().waitFor();
      for(const width of [1440,390]){
        await ui.setViewportSize({width,height:1000});
        const bounds=await ui.locator('.output-choice').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return {top:b.top,bottom:b.bottom,fits:node.scrollWidth<=node.clientWidth+1,height:b.height};}));
        assert.ok(bounds.length>=5);assert.ok(bounds.every(b=>b.fits&&b.height>=44));for(let n=1;n<bounds.length;n++)assert.ok(bounds[n].top>=bounds[n-1].bottom-1,'cards must not shrink and overlap');
        assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
        await ui.locator('.output-list').scrollIntoViewIfNeeded();await ui.screenshot({path:join(directory,`outputs-${width}.png`),fullPage:true});
      }
    });
    await t.test('the output picker distinguishes an image description from its matching URL',async()=>{
      await ui.setViewportSize({width:1440,height:1000});await ui.getByLabel('Find an output').fill('Example generated artwork');
      await ui.locator('.output-choice').filter({hasText:'Example generated artwork'}).click();
      await ui.getByText('This captures the image description (alt), not its URL.',{exact:false}).waitFor();
      await ui.getByLabel('Output name',{exact:true}).fill('image_url');
      await ui.getByText('This captures the image description (alt), not its URL.',{exact:false}).waitFor();
      await ui.getByRole('button',{name:'Use media URL instead',exact:true}).click();
      await ui.getByText('This captures the media URL.',{exact:false}).waitFor();
      assert.equal(await ui.getByLabel('Output name',{exact:true}).inputValue(),'image_url');
      assert.ok((await ui.locator('.output-selection code').innerText()).endsWith('/sandbox/preview-art.svg'));
      await ui.getByLabel('Find an output').fill('');
    });
    snap=await snapshot();const output=snap.elements.find(item=>item.kind==='output'&&item.preview==='1');assert.ok(output);
    const recordingResponse=await ui.request.get(origin+'/studio/overview');assert.equal(recordingResponse.ok(),true);
    // Finish through the same recording API after exercising real UI controls.
    const requests=[];ui.on('request',request=>{if(/\/recordings\/.*\/output$/.test(request.url()))requests.push(request.postDataJSON());});
    await ui.setViewportSize({width:1440,height:1000});await ui.getByLabel('Find an output').fill('1');
    const choice=ui.locator('.output-choice').filter({has:ui.getByText('1',{exact:true})}).first();await choice.click();await ui.getByLabel('Output name',{exact:true}).fill('count');await ui.getByRole('button',{name:'Add output',exact:true}).click();
    await ui.getByRole('button',{name:'Define verification',exact:true}).click();await ui.getByLabel('count',{exact:true}).selectOption('changed');await ui.getByRole('checkbox',{name:/I authorize replaying/}).check();await ui.getByRole('button',{name:'Save & test action',exact:true}).click();
    const workflow=(await ok('/studio/overview')).workflows.find(workflow=>workflow.slug==='preview.recording');assert.deepEqual(workflow.steps.map(step=>step.op),['click','fill']);
    await ui.getByRole('button',{name:'Run verification',exact:true}).click();await ui.getByText('Result verified',{exact:true}).waitFor();assert.equal(await site.evaluate(()=>globalThis.submissions),2);assert.deepEqual(errors,[]);
    console.log('Preview UI evidence: '+directory);
  }catch(error){if(ui)await ui.screenshot({path:join(directory,'failure.png'),fullPage:true});throw error;}
  finally{closed=true;await app.close();await loop?.catch(()=>{});await browser?.close();}
});
