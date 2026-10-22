import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('step editor preserves stable IDs and protected actions through keyboard reorder, duplication and deletion',{timeout:90000},async()=>{
  const previousMaster=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/step-identity-ui',randomUUID());mkdirSync(directory,{recursive:true});
  // Authoring uses the real built UI, owner routes and encrypted database.
  // The engine is controlled and this test never executes a website action.
  const engine={isOpen:()=>true,isPairing:()=>false,closeAll:async()=>{},closeStudios:async()=>{}};
  let state,browser,page,cookie='',csrf='';const errors=[];
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-step-identity-ui-owner'})).csrf;
    const at=new Date().toISOString(),cid='conn_step_identity_ui',wid='wf_step_identity_ui',base='/studio/workflows/'+wid,url=origin+'/sandbox/step-identity-ui';
    const definition={contract_version:'2',steps:[{op:'fill',selector:'#prepare',value:'Fixture request',label:'Prepare request'},{op:'click',selector:'#submit',label:'Submit request'},{op:'wait_text',selector:'#result',text:'Ready',label:'Check result'}],approval_policy:{mode:'selected_steps',steps:[2,3]},inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Step identity browser',url,'connected',store.seal({url,origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Step identity action','step.identity.ui','published',definition.version,store.seal(definition),definition.version,at);
    await call('/studio/overview');const revision=store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid),original=store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(wid);
    const projected=(await call(base+'/editor')).definition;assert.equal(store.unseal(original.payload).steps.every(step=>step.id===undefined),true);
    assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(wid),original);
    await app.listen({host:'127.0.0.1',port});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Verify your action',exact:true});await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();
    const editor=dialog.locator('.workflow-editor'),timeline=editor.locator('.workflow-editor-timeline'),configuration=editor.getByRole('region',{name:'Selected step configuration',exact:true}),policy=editor.getByRole('region',{name:'Workflow approval policy',exact:true}),save=editor.getByRole('button',{name:'Save draft',exact:true});
    await editor.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();
    const review=()=>editor.getByRole('checkbox',{name:/Steps changed/});
    const acceptReview=async()=>{assert.equal(await save.isDisabled(),true);await review().focus();await page.keyboard.press('Space');assert.equal(await review().count(),0);assert.equal(await save.isEnabled(),true);};
    const saveDraft=async()=>{const response=page.waitForResponse(value=>value.url()===origin+base+'/editor'&&value.request().method()==='POST');await save.click();const value=await response;assert.equal(value.status(),200);const body=await value.json();await editor.getByText('Draft saved. Run verification before publishing this revision.',{exact:true}).waitFor();return body.definition;};
    const fit=async(label)=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await editor.evaluate(element=>element.scrollIntoView({block:'start'}));const bounds=await editor.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,editor:element.scrollWidth<=element.clientWidth+1,dialogs:[...document.querySelectorAll('[role=dialog]')].every(item=>item.scrollWidth<=item.clientWidth+1)}));assert.deepEqual(bounds,{page:true,editor:true,dialogs:true},`${label} fits ${width}px`);await page.screenshot({path:join(directory,`${label}-${width}.png`)});}};
    await timeline.locator('li button').nth(1).click();assert.equal(await configuration.getByLabel('Description',{exact:true}).inputValue(),'Submit request');
    await configuration.getByRole('button',{name:'Move step up',exact:true}).focus();await page.keyboard.press('Space');
    assert.equal(await configuration.getByLabel('Description',{exact:true}).inputValue(),'Submit request');assert.equal(await policy.getByRole('checkbox',{name:'1. Submit request',exact:true}).isChecked(),true);assert.equal(await policy.getByRole('checkbox',{name:'2. Prepare request',exact:true}).isChecked(),false);assert.equal(await policy.getByRole('checkbox',{name:'3. Check result',exact:true}).isChecked(),true);
    await acceptReview();const reordered=await saveDraft();assert.deepEqual(reordered.steps.map(step=>step.id),[projected.steps[1].id,projected.steps[0].id,projected.steps[2].id]);assert.deepEqual(reordered.approval_policy,{mode:'selected_steps',steps:[1,3]});
    await timeline.locator('li button').first().click();await configuration.getByRole('button',{name:'Duplicate step',exact:true}).click();
    assert.equal(await configuration.getByRole('checkbox',{name:/Pause for owner approval before this step/}).isChecked(),true,'A duplicate of a policy-protected action retains an explicit approval gate');
    await acceptReview();const duplicated=await saveDraft();assert.equal(new Set(duplicated.steps.map(step=>step.id)).size,4);assert.equal(duplicated.steps[0].id,reordered.steps[0].id);assert.notEqual(duplicated.steps[1].id,reordered.steps[0].id);assert.equal(duplicated.steps[1].approval_required,true);assert.deepEqual(duplicated.approval_policy,{mode:'selected_steps',steps:[1,4]});
    await timeline.locator('li button').first().click();await configuration.getByRole('button',{name:'Delete step',exact:true}).click();
    assert.equal(await policy.getByRole('checkbox',{name:'1. Submit request',exact:true}).isChecked(),false,'Deleting the selected action must not transfer its numbered policy gate to its neighbour');assert.equal(await policy.getByRole('checkbox',{name:'2. Prepare request',exact:true}).isChecked(),false);assert.equal(await policy.getByRole('checkbox',{name:'3. Check result',exact:true}).isChecked(),true);
    assert.equal(await configuration.getByRole('checkbox',{name:/Pause for owner approval before this step/}).isChecked(),true,'The separately identified duplicate keeps its explicit gate');
    await fit('step-identity-deletion-review');await acceptReview();const deleted=await saveDraft();assert.deepEqual(deleted.steps.map(step=>step.id),[duplicated.steps[1].id,projected.steps[0].id,projected.steps[2].id]);assert.deepEqual(deleted.approval_policy,{mode:'selected_steps',steps:[3]});assert.equal(deleted.steps[0].approval_required,true);
    assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid),revision,'Editing never rewrites the active legacy publication');assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(wid).revision,1);assert.equal(store.db.prepare('SELECT test_version FROM workflows WHERE id=?').get(wid).test_version,null);
    const stored=store.unseal(store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(wid).payload);assert.deepEqual(stored.steps,deleted.steps);await fit('step-identity-saved-draft');assert.deepEqual(errors,[]);console.log('Step identity UI screenshots: '+directory);
  }catch(error){if(page){await page.screenshot({path:join(directory,'failure.png')});console.log('Step identity UI failure screenshot: '+join(directory,'failure.png'));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previousMaster===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMaster;}
});
