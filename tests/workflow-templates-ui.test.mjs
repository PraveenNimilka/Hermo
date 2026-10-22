import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';

test('built template UI imports, configures and exports a clean draft without website execution at desktop and mobile sizes',{timeout:60000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/template-ui',randomUUID());mkdirSync(directory,{recursive:true});
  let executions=0,opens=0,state,browser,page,cookie='',csrf='';const errors=[];
  const engine={isOpen:()=>true,isPairing:()=>false,closeAll:async()=>{},closeStudios:async()=>{},open:async()=>{opens++;throw Error('Unexpected browser open');},execute:async()=>{executions++;throw Error('Unexpected website execution');}};
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-template-ui-password'})).csrf;
    const at=new Date().toISOString(),url=origin+'/sandbox/template-ui';
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_template_ui','Template UI website',url,'connected',store.seal({url,origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    await app.listen({host:'127.0.0.1',port});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Use a workflow template',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Start with a template',exact:true});
    await dialog.getByRole('button',{name:/Detail page Visit one approved page/}).waitFor();
    const fit=async(label)=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1000});const bounds=await dialog.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,dialog:element.scrollWidth<=element.clientWidth+1}));assert.deepEqual(bounds,{page:true,dialog:true},label+' '+width);await page.screenshot({path:join(directory,label+'-'+width+'.png')});}};
    await fit('template-catalog');
    await dialog.getByLabel('Find a template',{exact:true}).fill('dashboard');assert.equal(await dialog.locator('.workflow-template-catalog button').count(),1);
    await dialog.getByLabel('Find a template',{exact:true}).fill('no matching template xyz');await dialog.getByRole('status').filter({hasText:'No templates match your search.'}).waitFor();
    await dialog.getByRole('button',{name:'Clear search',exact:true}).click();assert.equal(await dialog.getByLabel('Find a template',{exact:true}).inputValue(),'');assert.ok(await dialog.locator('.workflow-template-catalog button').count()>1);
    await dialog.getByText('Import structural JSON',{exact:true}).click();await dialog.getByLabel('Template JSON',{exact:true}).fill(JSON.stringify({format:'hermo.template.v1',url:'https://private.example/'}));await dialog.getByRole('button',{name:'Validate import',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(store.db.prepare('SELECT count(*) n FROM workflows').get().n,0);
    const template=(await call('/studio/templates')).templates.find(entry=>entry.id==='detail-page').template;
    await dialog.getByLabel('Template JSON',{exact:true}).fill(JSON.stringify(template));await dialog.getByRole('button',{name:'Validate import',exact:true}).click();await dialog.getByRole('heading',{name:'Imported template',exact:true}).waitFor();
    await dialog.getByLabel('Authorized connection',{exact:true}).selectOption('conn_template_ui');await dialog.getByLabel('Action name',{exact:true}).fill('Template UI draft');await dialog.getByLabel('Action slug',{exact:true}).fill('template.ui.draft');
    const config={targets:{target_1:'#answer'},urls:{url_1:url},values:{}};await dialog.getByLabel('Website configuration JSON',{exact:true}).fill(JSON.stringify(config,null,2));
    const create=dialog.getByRole('button',{name:'Create draft',exact:true});assert.equal(await create.isDisabled(),true);
    await dialog.getByText('Review template structure',{exact:true}).click();
    const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download clean template',exact:true}).click();const stream=await (await downloaded).createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const text=Buffer.concat(chunks).toString();assert.deepEqual(JSON.parse(text),template);assert.doesNotMatch(text,/#answer|conn_template|127\.0\.0\.1|template\.ui\.draft/);
    await fit('template-configured');
    await dialog.getByRole('checkbox',{name:/I authorize this existing connection/}).check();assert.equal(await create.isEnabled(),true);
    const response=page.waitForResponse(response=>response.url()===origin+'/studio/templates/instantiate');await create.click();assert.equal((await response).status(),200);await page.getByRole('dialog',{name:'Verify your action',exact:true}).waitFor();
    const row=store.db.prepare('SELECT * FROM workflows').get();assert.equal(row.name,'Template UI draft');assert.equal(row.status,'draft');assert.equal(row.test_version,null);assert.equal(store.db.prepare('SELECT count(*) n FROM workflow_revisions').get().n,0);assert.equal(executions,0);assert.equal(opens,0);
    assert.deepEqual(errors,[]);console.log('Template UI screenshots: '+directory);
  }catch(error){if(page)await page.screenshot({path:join(directory,'failure.png')});throw error;}
  finally{await browser?.close();await state?.app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
