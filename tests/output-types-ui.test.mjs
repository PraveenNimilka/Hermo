import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('output editor exposes null-only schemas and explicit scalar conversion without invalid inherited settings',{timeout:90000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/output-types-ui',randomUUID());mkdirSync(directory,{recursive:true});
  // This checks actual draft authoring and its persisted schema. The controlled
  // engine does not extract a website or claim that DOM text is natively typed.
  const engine={isOpen:()=>true,isPairing:()=>false,closeAll:async()=>{},closeStudios:async()=>{}};
  let state,browser,page,cookie='',csrf='';const errors=[];
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-output-types-ui-owner'})).csrf;
    const at=new Date().toISOString(),cid='conn_output_types_ui',wid='wf_output_types_ui',url=origin+'/sandbox/output-types';
    const definition={contract_version:'2',steps:[],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string',nullable:true,coercion:'strict',read_attribute:'alt'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Output types fixture',url,'connected',store.seal({url,origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Output types action','output.types.ui','published',definition.version,store.seal(definition),definition.version,at);
    await call('/studio/overview');const original=store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid).payload;
    await app.listen({host:'127.0.0.1',port});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Verify your action',exact:true});await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();const editor=dialog.locator('.workflow-editor'),mapping=editor.locator('.output-mapping').first();await editor.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();
    const save=async()=>{const pending=page.waitForResponse(response=>response.url()===origin+`/studio/workflows/${wid}/editor`&&response.request().method()==='POST');await editor.getByRole('button',{name:'Save draft',exact:true}).click();const response=await pending;assert.equal(response.status(),200);await editor.getByText('Draft saved. Run verification before publishing this revision.',{exact:true}).waitFor();return (await response.json()).definition;};
    await mapping.getByLabel('Value type',{exact:true}).selectOption('null');assert.equal(await mapping.getByLabel('Read',{exact:true}).count(),0);assert.equal(await mapping.getByRole('checkbox',{name:'Allow null when missing',exact:true}).count(),0);assert.equal(await mapping.getByLabel('Scalar conversion',{exact:true}).inputValue(),'legacy');
    await mapping.getByText('Value constraints',{exact:true}).click();const values=mapping.getByLabel('Allowed values (JSON array)',{exact:true});await values.fill('["null"]');assert.equal(await values.getAttribute('aria-invalid'),'true');await values.fill('[null]');assert.equal(await values.getAttribute('aria-invalid'),null);
    let saved=await save();assert.equal(saved.outputs[0].type,'null');assert.deepEqual(saved.outputs[0].enum,[null]);assert.equal(saved.outputs[0].nullable,undefined);assert.equal(saved.outputs[0].coercion,undefined);assert.equal(saved.outputs[0].read_attribute,undefined);
    await mapping.getByLabel('Value type',{exact:true}).selectOption('number');await mapping.getByLabel('Scalar conversion',{exact:true}).selectOption('strict');await mapping.getByRole('checkbox',{name:'Allow null when missing',exact:true}).check();assert.match(await mapping.textContent(),/DOM text and attributes are strings; use legacy conversion/);saved=await save();assert.equal(saved.outputs[0].coercion,'strict');assert.equal(saved.outputs[0].nullable,true);assert.equal(saved.outputs[0].enum,undefined);
    for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await mapping.evaluate(element=>element.scrollIntoView({block:'start'}));const fits=await mapping.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,panel:element.scrollWidth<=element.clientWidth+1,dialogs:[...document.querySelectorAll('[role=dialog]')].every(item=>item.scrollWidth<=item.clientWidth+1)}));assert.deepEqual(fits,{page:true,panel:true,dialogs:true});await page.screenshot({path:join(directory,`strict-output-${width}.png`)});}
    await mapping.getByLabel('Value type',{exact:true}).selectOption('object');const child=mapping.locator('.output-mapping').first();await child.getByLabel('Extraction selector',{exact:true}).fill('#value');saved=await save();assert.equal(saved.outputs[0].coercion,undefined);assert.equal(saved.outputs[0].nullable,undefined);assert.equal(saved.outputs[0].type,'object');assert.equal(saved.outputs[0].fields[0].selector,'#value');
    await child.getByLabel('Value type',{exact:true}).selectOption('null');await child.getByLabel('Scalar conversion',{exact:true}).selectOption('legacy');saved=await save();assert.equal(saved.outputs[0].fields[0].type,'null');assert.equal(saved.outputs[0].fields[0].coercion,'legacy');assert.equal(saved.outputs[0].fields[0].nullable,undefined);
    assert.equal(store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid).payload,original);assert.equal(store.db.prepare('SELECT test_version FROM workflows WHERE id=?').get(wid).test_version,null);assert.deepEqual(errors,[]);console.log('Output types UI screenshots: '+directory);
  }catch(error){if(page){await page.screenshot({path:join(directory,'failure.png')});console.log('Output types UI failure screenshot: '+join(directory,'failure.png'));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
