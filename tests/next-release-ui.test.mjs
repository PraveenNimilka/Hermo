import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('projects, revision history, editor and scoped-key playground work in desktop and mobile UI',{timeout:100000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4430,dataDir=resolve('work/next-release-ui',randomBytes(6).toString('hex'));mkdirSync(dataDir,{recursive:true});
  const {app,store,origin}=await createApp({port,dataDir});let browser;
  app.get('/sandbox/ui-catalog',async(req,reply)=>reply.type('text/html').send('<h1>Product catalog</h1><article class="product"><h2 class="title">Notebook</h2><span class="price">149.99</span></article><article class="product"><h2 class="title">Pen</h2><span class="price">2.50</span></article>'));
  let cookie='',csrf='';
  const call=async(path,body)=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];assert.ok(r.statusCode<300,r.body);return r.json();};
  const finish=async rid=>{for(let n=0;n<200;n++){const value=await call('/studio/runs/'+rid);if(['succeeded','failed'].includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('Run never finished');};
  try{
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-ui-workspace-password'})).csrf;
    const at=new Date().toISOString(),cid='catalog_connection',wid='catalog_workflow',connection={url:origin+'/sandbox/ui-catalog',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Catalog browser',connection.url,'connected',store.seal(connection),at);
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('catalog_target','Dedicated catalog browser',connection.url,'connected',store.seal(connection),at);
    const definition={steps:[],inputs:{},outputs:[{name:'price',selector:'.price',read_mode:'last',type:'string'}],verifiers:[{kind:'nonempty',output:'price'}],effect:'retrieval',timeout_ms:15000};
    // Managed reads intentionally require a single target.
    definition.outputs[0].selector='.product:first-of-type .price';delete definition.outputs[0].read_mode;definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Catalog lookup','catalog.lookup','draft',definition.version,store.seal(definition),null,at);
    await app.listen({port,host:'127.0.0.1'});
    assert.equal((await finish((await call(`/studio/workflows/${wid}/test`,{input:{}})).run_id)).status,'succeeded');
    const first=await call(`/studio/workflows/${wid}/publish`,{});
    await call(`/studio/workflows/${wid}/draft`,{expected_version:first.workflow.version});
    const editable=await call(`/studio/workflows/${wid}/editor`),products={name:'products',type:'array',selector:'.product',items:{type:'object',fields:[{name:'title',selector:'.title',type:'string'},{name:'price',selector:'.price',type:'number'},{name:'sale',selector:'.sale',required:false,type:'boolean'}]}};
    await call(`/studio/workflows/${wid}/editor`,{expected_version:editable.version,steps:[],inputs:{},outputs:[...definition.outputs,products],verifiers:definition.verifiers,timeout_seconds:15});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();
    await page.getByRole('button',{name:'Edit draft',exact:true}).click();
    let dialog=page.getByRole('dialog');
    const execution=dialog.locator('.execution-target');await execution.getByLabel('Authorized execution connection').selectOption('catalog_target');
    for(const width of [1440,768,375]){
      await page.setViewportSize({width,height:1000});await execution.evaluate(element=>element.scrollIntoView({block:'start'}));
      // Styled pickers reserve arrow space with an icon and gap; fallback selects use background padding.
      const geometry=await execution.evaluate(panel=>{const field=panel.querySelector('.field'),select=field.querySelector('select'),button=panel.querySelector('button'),p=panel.getBoundingClientRect(),f=field.getBoundingClientRect(),s=select.getBoundingClientRect(),b=button.getBoundingClientRect(),style=getComputedStyle(select),custom=style.appearance==='base-select';return {aligned:Math.abs(f.left-b.left)<1,inset:custom?style.paddingLeft:style.backgroundPosition,padding:parseFloat(style.paddingRight)+(custom?parseFloat(style.columnGap)+parseFloat(getComputedStyle(select,'::picker-icon').width):0),fieldMargin:parseFloat(getComputedStyle(field).marginBottom),width:s.width,fits:s.right<=p.right-15&&b.right<=p.right-15};});
      assert.equal(geometry.aligned,true,'execution action shares field inset '+width);assert.equal(geometry.fieldMargin,0);assert.ok(geometry.padding>=40&&geometry.width<=640&&geometry.fits,'execution controls fit '+width);assert.match(geometry.inset,/12px/);
      await page.screenshot({path:join(dataDir,`execution-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:1000});await execution.getByLabel('Authorized execution connection').selectOption(cid);
    await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();await dialog.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();
    const mapping=dialog.locator('.output-mapping').first();assert.ok(await dialog.getByText('products',{exact:true}).count()>0);await mapping.locator('select').first().selectOption('number');await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await dialog.getByText('Draft saved. Run verification before publishing this revision.').waitFor();
    for(const width of [1440,768,375]){
      await page.setViewportSize({width,height:1000});
      await dialog.locator('.workflow-editor').evaluate(element=>element.scrollIntoView({block:'start'}));
      const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.x>=-1&&bounds.x+bounds.width<=width+1,'editor fits '+width);
      const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth+1,dialog:[...document.querySelectorAll('[role=dialog]')].some(e=>e.scrollWidth>e.clientWidth+1)}));assert.deepEqual(overflow,{document:false,dialog:false},'editor overflow '+width);
      await page.screenshot({path:join(dataDir,`editor-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:1000});await dialog.getByRole('button',{name:'Run verification',exact:true}).click();await dialog.getByRole('button',{name:'Publish draft revision',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Publish draft revision',exact:true}).click();await page.getByRole('heading',{name:'Your action is ready.',exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Version history',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Compare with live',exact:true}).click();await dialog.getByRole('region',{name:'Revision comparison'}).waitFor();await dialog.getByText('Changed: outputs').waitFor();await page.screenshot({path:join(dataDir,'revisions-desktop.png')});await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Version history',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Open draft',exact:true}).click();await page.getByRole('heading',{name:'Verify your action',exact:true}).waitFor();
    assert.equal((await call('/studio/overview')).workflows.find(value=>value.id===wid).draft_open,true,'Version history opens a real editable draft without changing the active publication');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'API docs',exact:true}).click();const playground=page.locator('.api-playground');await playground.getByLabel('Scoped API key',{exact:true}).fill(first.key);await playground.getByRole('button',{name:'Connect key',exact:true}).click();await playground.getByText('Scoped key verified. Requests use the consumer API and its published contract.').waitFor();await playground.getByRole('button',{name:'Run API request',exact:true}).click();await playground.getByText('Verified result received.',{exact:true}).waitFor();
    assert.match(await playground.getByLabel('API response JSON').textContent(),/"price": 149.99/);assert.equal(await playground.getByLabel('Scoped API key',{exact:true}).inputValue(),'');
    await playground.getByRole('button',{name:'View run details',exact:true}).click();await page.getByRole('dialog').getByText(/^Revision 2 /).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();
    for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'playground overflow '+width);await page.screenshot({path:join(dataDir,`playground-${width}.png`),fullPage:true});}
    await page.getByRole('button',{name:'Manage local projects',exact:true}).click();
    dialog=page.getByRole('dialog');await dialog.getByLabel('New project name',{exact:true}).fill('Product Intelligence');
    await dialog.getByRole('button',{name:'Create project',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('select[aria-label="Current project"]')?.selectedOptions[0]?.textContent==='Product Intelligence');
    await page.getByRole('combobox',{name:'Current project',exact:true}).selectOption('project_personal');await page.locator('.api-playground').waitFor();
    assert.deepEqual(errors,[]);console.log('UI screenshots: '+dataDir);
  }catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:join(dataDir,'failure.png')});console.log('UI failure screenshot: '+join(dataDir,'failure.png'));console.log((await page.locator('[role=dialog]').allTextContents()).join(' ').slice(0,4500));}}throw error;}finally{await browser?.close();await app.close();}
});
