import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('nested input authoring requires a scalar JSON value path and preserves structured defaults and the published revision',{timeout:90000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/nested-input-ui',randomUUID());mkdirSync(directory,{recursive:true});
  // Built dashboard and real owner routes/store are exercised. No browser
  // action or verification is executed by this authoring-only fixture.
  let executions=0;const engine={isOpen:()=>true,isPairing:()=>false,closeAll:async()=>{},closeStudios:async()=>{},execute:async()=>{executions++;throw Error('Authoring fixture must not execute');}};
  let state,browser,page,cookie='',csrf='';const errors=[],testRequests=[];
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-nested-input-ui-owner'})).csrf;
    const at=new Date().toISOString(),cid='conn_nested_input_ui',wid='wf_nested_input_ui',url=origin+'/sandbox/nested-input';
    const definition={contract_version:'2',steps:[{id:'step_request_query',op:'fill',selector:'#query',parameter:'request',label:'Search query'}],inputs:{request:{type:'string',required:true,example:'Previous request'}},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Nested input fixture',url,'connected',store.seal({url,origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Nested input action','nested.input.ui','published',definition.version,store.seal(definition),definition.version,at);
    await call('/studio/overview');const original=store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid).payload,initial=store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid);
    await app.listen({host:'127.0.0.1',port});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(`/studio/workflows/${wid}/test`))testRequests.push(request.url());});
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Verify your action',exact:true});await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();const editor=dialog.locator('.workflow-editor'),config=editor.getByRole('region',{name:'Selected step configuration',exact:true}),inputMapping=editor.locator('.input-mappings');await editor.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();const editingBaseline=store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid);
    await inputMapping.getByText('Advanced definition for request',{exact:true}).click();const definitionEditor=inputMapping.getByLabel('Input definition JSON for request',{exact:true});
    await definitionEditor.fill('{invalid');await inputMapping.getByRole('button',{name:'Apply input definition',exact:true}).click();await inputMapping.getByRole('alert').filter({hasText:'Enter valid JSON.'}).waitFor();assert.deepEqual(store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid),editingBaseline);
    const nested={type:'object',required:true,properties:{query:{type:'string',required:true,minLength:1,maxLength:80},limit:{type:'integer',required:false,default:5,minimum:1,maximum:10}},default:{query:'Saved search'},example:{query:'Example search',limit:3}};
    await definitionEditor.fill(JSON.stringify(nested,null,2));await inputMapping.getByRole('button',{name:'Apply input definition',exact:true}).click();await inputMapping.getByText('Definition applied to this draft. Save the workflow to validate it.',{exact:true}).waitFor();assert.equal(await inputMapping.getByLabel(/^Type for request/).inputValue(),'object');
    const path=config.getByLabel('Input value path (JSON array)',{exact:true}),save=editor.getByRole('button',{name:'Save draft',exact:true});assert.equal(await path.inputValue(),'[]');
    const rejected=page.waitForResponse(response=>response.url()===origin+`/studio/workflows/${wid}/editor`&&response.request().method()==='POST');await save.click();assert.equal((await rejected).status(),400,'A structured object cannot bind directly to a browser text field');assert.deepEqual(store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid),editingBaseline);
    await path.fill('["query"');assert.equal(await save.isDisabled(),true);await editor.getByRole('alert').filter({hasText:'use a JSON array of up to four field names or indices'}).waitFor();
    await path.fill('["query"]');assert.equal(await save.isEnabled(),true);
    const fit=async(label,target)=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await target.evaluate(element=>element.scrollIntoView({block:'start'}));const bounds=await editor.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,editor:element.scrollWidth<=element.clientWidth+1,dialogs:[...document.querySelectorAll('[role=dialog]')].every(item=>item.scrollWidth<=item.clientWidth+1)}));assert.deepEqual(bounds,{page:true,editor:true,dialogs:true});await page.screenshot({path:join(directory,`${label}-${width}.png`)});}};
    await fit('nested-input-definition',definitionEditor);await fit('nested-input-value-path',path);
    const accepted=page.waitForResponse(response=>response.url()===origin+`/studio/workflows/${wid}/editor`&&response.request().method()==='POST');await save.click();const response=await accepted;assert.equal(response.status(),200);const saved=(await response.json()).definition;
    assert.equal(saved.inputs.request.type,'object');assert.equal(saved.inputs.request.properties.query.required,true);assert.equal(saved.inputs.request.properties.limit.default,5);assert.equal(saved.inputs.request.default.query,'Saved search');assert.deepEqual(saved.steps[0].value_path,['query']);assert.equal(saved.steps[0].id,definition.steps[0].id);assert.equal(saved.steps[0].parameter,'request');
    assert.deepEqual(store.unseal(store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(wid).payload),saved);assert.equal(store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid).payload,original);assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(wid).revision,1);assert.equal(store.db.prepare('SELECT test_version FROM workflows WHERE id=?').get(wid).test_version,null);
    const requestField=dialog.getByLabel('request',{exact:true});assert.equal(await requestField.evaluate(element=>element.tagName),'TEXTAREA');const current=JSON.parse(await requestField.inputValue());assert.equal(current.query,'Saved search');
    await requestField.fill('{invalid');await dialog.getByRole('button',{name:'Run verification',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Enter valid JSON for this field.'}).waitFor();assert.deepEqual(testRequests,[]);assert.equal(executions,0);assert.deepEqual(errors,[]);console.log('Nested input UI screenshots: '+directory);
  }catch(error){if(page){await page.screenshot({path:join(directory,'failure.png')});console.log('Nested input UI failure screenshot: '+join(directory,'failure.png'));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
