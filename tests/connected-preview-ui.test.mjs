import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {mediaTargetPresets} from '../companion/browser/media-targets.mjs';

// UI contract fixture only. Real extension capture and generated-media execution
// are exercised separately against disposable Chrome profiles.
test('website preview states, mobile layout and existing draft media repair',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/connected-preview-ui',randomBytes(6).toString('hex')),port=4457;
  mkdirSync(dataDir,{recursive:true});
  const {app,origin,store}=await createApp({port,dataDir});let browser,cookie='',csrf='';
  const call=async(path,body)=>{const reply=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(reply.headers['set-cookie'])cookie=reply.headers['set-cookie'].split(';')[0];assert.ok(reply.statusCode<300,reply.body);return reply.json();};
  try{
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-preview-ui-password'})).csrf;
    const at=new Date().toISOString(),connection={url:'https://example.com/',origins:['https://example.com'],browser_mode:'connected',access:'account',identity:{kind:'selected_tab',origin:'https://example.com'}};
    const definition={contract_version:'2',action_type:'generate_media',effect:'recorded_browser_actions',timeout_ms:180000,steps:[{op:'fill',selector:'#prompt',parameter:'prompt'},{op:'click',selector:'#generate'}],inputs:{prompt:{type:'string',required:true}},outputs:[{name:'image_url',selector:'#old-turn-image',read_attribute:'src',type:'url',media_type:'image'}],verifiers:[{kind:'url',output:'image_url'}]};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('preview_connection','Image studio',connection.url,'connected',store.seal(connection),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('preview_workflow','preview_connection','Generate artwork','images.generate','draft',definition.version,store.seal(definition),null,at);
    await app.listen({port,host:'127.0.0.1'});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/sandbox/orders');const image=(await page.screenshot({type:'jpeg'})).toString('base64');let mode='disabled';
    await page.route('**/studio/overview?*',async route=>{const response=await route.fetch(),value=await response.json();value.connections=value.connections.map(c=>({...c,status:'connected',display_status:'connected',browser_linked:true}));await route.fulfill({response,json:value});});
    await page.route('**/studio/connections/preview_connection/browser-link',route=>route.fulfill({json:{mode:'connected',linked:true,confirmed:true}}));
    await page.route('**/studio/connections/preview_connection/open',route=>route.fulfill({json:{ok:true}}));
    await page.route('**/studio/connections/preview_connection/browser',route=>mode==='failed'?route.fulfill({status:422,json:{error:{code:'BROWSER_TAB_UNAVAILABLE',message:'Synthetic disconnected fixture'}}}):route.fulfill({json:{url:connection.url,title:'Image studio',image:mode==='live'||mode==='stale'?image:'',preview:{state:mode==='live'||mode==='stale'?'live':'disabled',captured_at:Date.now()-(mode==='stale'?10000:0),width:1440,height:1000},mode:'connected',state:'ready',can_confirm:true,approved_origins:connection.origins,viewport:{width:1440,height:1000},diagnostics:{blocked:[],failed:[],http_status:200},tabs:[{id:'paired',url:connection.url,active:true}],elements:[{id:'input',kind:'input',type:'editor',label:'Prompt',value:''},{id:'asset',kind:'output',label:'Latest image URL',preview:'https://example.com/generated.png',read_attribute:'src',semantic_role:'media',read_mode:'last',type:'image_url'}]}}));
    await page.goto(origin);await page.getByRole('button',{name:'Connections',exact:true}).click();
    await page.locator('.connection-card').getByRole('button',{name:'Open browser',exact:true}).click();
    const dialog=page.getByRole('dialog'),preview=dialog.getByRole('region',{name:'Connected website preview'});
    await preview.getByRole('heading',{name:'Show the actual website here'}).waitFor();assert.equal(await preview.locator('img').count(),0);
    await preview.getByRole('button',{name:'Detected fields',exact:true}).click();await preview.getByText('https://example.com/generated.png',{exact:true}).waitFor();assert.equal(await preview.locator('.connected-message.assistant').count(),0,'latest media is a data result, not an assistant message');
    await preview.getByRole('button',{name:'Website',exact:true}).click();mode='live';
    await preview.getByRole('img',{name:'Website preview of Image studio'}).waitFor();await preview.getByText('Live website',{exact:true}).waitFor();
    for(const width of [1440,768,375]){
      await page.setViewportSize({width,height:1000});await preview.scrollIntoViewIfNeeded();
      const dimensions=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,width:innerWidth,dialog:[...document.querySelectorAll('[role=dialog]')].some(el=>el.scrollWidth>el.clientWidth+1)}));assert.ok(dimensions.doc<=width+1&&!dimensions.dialog,JSON.stringify(dimensions));
      await page.screenshot({path:join(dataDir,'preview-'+width+'.png')});
    }
    mode='stale';await preview.getByRole('heading',{name:'Show the actual website here'}).waitFor();assert.equal(await preview.locator('img').count(),0,'stale frame disappears');
    mode='live';await preview.getByRole('img').waitFor();mode='failed';await dialog.getByText('Synthetic disconnected fixture',{exact:true}).waitFor();assert.equal(await preview.locator('img').count(),0,'disconnect removes previous frame');
    await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Test action',exact:true}).click();
    await page.getByText('Edit workflow steps and extraction',{exact:true}).click();await page.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();await page.screenshot({path:join(dataDir,'repair-editor.png')});
    await page.getByLabel('Result targeting',{exact:true}).selectOption('image');
    const preset=mediaTargetPresets.find(item=>item.value==='image');assert.equal(await page.getByLabel('Extraction selector',{exact:true}).inputValue(),preset.selector);
    await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved. Run verification before publishing this revision.').waitFor();
    const saved=(await call('/studio/workflows/preview_workflow/editor')).definition;assert.equal(saved.outputs[0].read_mode,'last');assert.equal(saved.outputs[0].selector,preset.selector);assert.equal(saved.outputs[0].media_type,'image');assert.equal(saved.steps.length,2);
    assert.equal(store.db.prepare('SELECT test_version FROM workflows WHERE id=?').get('preview_workflow').test_version,null);assert.deepEqual(errors,[]);
  }catch(error){if(browser){const pages=browser.contexts().flatMap(context=>context.pages());for(const page of pages){console.error((await page.locator('body').innerText()).slice(-9000));}}throw error;}finally{await browser?.close();await app.close();}
});
