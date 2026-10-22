import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('wait editor saves declarative conditions and preserves approval on duplicated waits without unsupported connected response options',{timeout:90000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/wait-editor-ui',randomUUID());mkdirSync(directory,{recursive:true});
  // The real owner routes and production dashboard handle authoring. Browser
  // execution is deliberately unused: this test does not claim runtime waits.
  const engine={isOpen:()=>true,isPairing:()=>false,closeAll:async()=>{},closeStudios:async()=>{}};
  let state,browser,page,cookie='',csrf='';const errors=[];
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-wait-editor-ui-owner'})).csrf;
    const at=new Date().toISOString();
    for(const [suffix,mode]of [['managed','isolated'],['connected','connected']]){
      const cid='conn_wait_editor_'+suffix,wid='wf_wait_editor_'+suffix,url=origin+'/sandbox/wait-editor';
      const definition={contract_version:'2',steps:[],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
      store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,suffix+' wait browser',url,'connected',store.seal({url,origins:[origin],access:'public',browser_mode:mode,identity:{kind:mode==='connected'?'selected_tab':'public_origin',origin}}),at);
      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,suffix==='managed'?'Managed waits fixture':'Connected waits fixture','wait.editor.'+suffix,'published',definition.version,store.seal(definition),definition.version,at);
    }
    await call('/studio/overview');const original=store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get('wf_wait_editor_managed').payload;
    await app.listen({host:'127.0.0.1',port});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();
    const card=name=>page.locator('.action-card').filter({has:page.getByRole('heading',{name,exact:true})});await card('Managed waits fixture').getByRole('button',{name:'Edit draft',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Verify your action',exact:true});await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();const editor=dialog.locator('.workflow-editor'),config=editor.getByRole('region',{name:'Selected step configuration',exact:true}),policy=editor.getByRole('region',{name:'Workflow approval policy',exact:true}),newStep=editor.getByLabel('New step',{exact:true});await editor.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();
    const add=async(op)=>{await newStep.selectOption(op);await editor.getByRole('button',{name:'Add step',exact:true}).click();};
    await add('wait_delay');await config.getByLabel('Delay duration (milliseconds)',{exact:true}).fill('1250');await config.getByLabel('When this wait times out',{exact:true}).selectOption('continue');await config.getByLabel('Step timeout (milliseconds)',{exact:true}).fill('2000');assert.equal(await config.getByRole('checkbox',{name:/Pause for owner approval/}).isDisabled(),true);
    await add('wait_navigation');await config.getByLabel('Expected navigation URL (optional)',{exact:true}).fill(origin+'/sandbox/wait-editor/completed');await config.getByLabel('Navigation completion',{exact:true}).selectOption('domcontentloaded');
    await add('wait_output');await config.getByLabel('Output to observe',{exact:true}).selectOption('answer');await config.getByLabel('Output condition',{exact:true}).selectOption('equals');await config.getByLabel('Comparison value type',{exact:true}).selectOption('boolean');await config.getByLabel('Expected output value',{exact:true}).selectOption('true');
    assert.equal(await config.locator('.locator-repair').count(),0,'Output waits do not offer irrelevant element locator repair');
    await add('wait_response');await config.getByLabel('Approved response URL',{exact:true}).fill(origin+'/sandbox/wait-editor/data');await config.getByLabel('Response request method',{exact:true}).selectOption('HEAD');await config.getByLabel('HTTP response status (optional)',{exact:true}).fill('204');
    const fit=async(label,target)=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await target.evaluate(element=>element.scrollIntoView({block:'start'}));const bounds=await editor.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,editor:element.scrollWidth<=element.clientWidth+1,dialogs:[...document.querySelectorAll('[role=dialog]')].every(item=>item.scrollWidth<=item.clientWidth+1)}));assert.deepEqual(bounds,{page:true,editor:true,dialogs:true});await page.screenshot({path:join(directory,`${label}-${width}.png`)});}};
    await fit('managed-response-wait',config);
    await policy.getByLabel('Workflow approval policy',{exact:true}).selectOption('selected_steps');await policy.getByRole('checkbox',{name:'1. Bounded delay',exact:true}).check();
    await editor.locator('.workflow-editor-timeline li button').first().click();await config.getByRole('button',{name:'Duplicate step',exact:true}).focus();await page.keyboard.press('Space');
    assert.equal(await config.getByRole('checkbox',{name:/Pause for owner approval/}).isChecked(),false,'Protected waits retain policy gates, not forbidden explicit wait flags');assert.equal(await policy.getByRole('checkbox',{name:'1. Bounded delay',exact:true}).isChecked(),true);assert.equal(await policy.getByRole('checkbox',{name:'2. Bounded delay',exact:true}).isChecked(),true);
    const save=editor.getByRole('button',{name:'Save draft',exact:true});assert.equal(await save.isDisabled(),true);await editor.getByRole('checkbox',{name:/Steps changed/}).focus();await page.keyboard.press('Space');assert.equal(await editor.getByRole('checkbox',{name:/Steps changed/}).count(),0);assert.equal(await save.isEnabled(),true);
    const posted=page.waitForResponse(response=>response.url()===origin+'/studio/workflows/wf_wait_editor_managed/editor'&&response.request().method()==='POST');await save.click();const response=await posted;assert.equal(response.status(),200);const saved=(await response.json()).definition;assert.equal(new Set(saved.steps.map(step=>step.id)).size,5);assert.deepEqual(saved.approval_policy,{mode:'selected_steps',steps:[1,2]});assert.equal(saved.steps[0].duration_ms,1250);assert.equal(saved.steps[0].error_policy,'continue');assert.equal(saved.steps[1].approval_required,undefined);assert.equal(saved.steps[2].state,'domcontentloaded');assert.equal(saved.steps[3].value,true);assert.equal(saved.steps[4].method,'HEAD');assert.equal(saved.steps[4].status,204);
    assert.equal(store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get('wf_wait_editor_managed').payload,original);
    await dialog.getByRole('button',{name:'Close',exact:true}).click();await card('Connected waits fixture').getByRole('button',{name:'Edit draft',exact:true}).click();await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();await editor.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();
    assert.equal(await newStep.locator('option[value="wait_response"]').count(),0,'Unsupported response wait is absent from connected authoring choices');for(const op of ['wait_delay','wait_navigation','wait_output'])assert.equal(await newStep.locator(`option[value="${op}"]`).count(),1);
    await add('click');assert.equal(await config.getByLabel('When this wait times out',{exact:true}).count(),0,'Website actions cannot continue after failure');assert.match(await config.textContent(),/Browser actions stop the run on error/);
    await fit('connected-action-errors',config);assert.deepEqual(errors,[]);console.log('Wait editor UI screenshots: '+directory);
  }catch(error){if(page){await page.screenshot({path:join(directory,'failure.png')});console.log('Wait editor UI failure screenshot: '+join(directory,'failure.png'));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
