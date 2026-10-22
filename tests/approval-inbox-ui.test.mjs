import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('owner configures risk policy then rejects and approves real controlled actions through the responsive inbox',{timeout:120000},async()=>{
  const bundles=readdirSync(resolve('dist/assets')).filter(file=>file.endsWith('.js')).map(file=>readFileSync(resolve('dist/assets',file),'utf8')).join('\n');
  assert.ok(bundles.includes('Approval inbox')&&bundles.includes('Workflow approval policy'),'Build the dashboard with the integrated approval inbox and policy editor before this browser test.');
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const dataDir=resolve('work/approval-inbox-ui',randomUUID());mkdirSync(dataDir,{recursive:true});
  const {app,store,origin}=await createApp({port,dataDir});let browser,page,cookie='',csrf='',submissions=0;
  app.get('/sandbox/approval-inbox',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Approval inbox fixture</title><p id="lookup">Lookup ready</p><button id="submit" aria-label="Submit controlled record">Submit controlled record</button><p id="result">Waiting</p><script src="/sandbox/approval-inbox.js"></script>'));
  app.get('/sandbox/approval-inbox.js',async(_,reply)=>reply.type('text/javascript').send("document.querySelector('#submit').addEventListener('click',async()=>{await fetch('/sandbox/approval-inbox-observed');document.querySelector('#result').textContent='Submitted';});"));
  app.get('/sandbox/approval-inbox-observed',async()=>{submissions++;return {ok:true};});
  const call=async(path,body)=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
  const observe=async(id,predicate)=>{for(let n=0;n<400;n++){const run=await call('/studio/runs/'+id);if(predicate(run))return run;await new Promise(done=>setTimeout(done,50));}assert.fail('Run did not reach expected state');};
  const terminal=id=>observe(id,run=>['succeeded','failed','cancelled'].includes(run.status));
  try{
    await app.listen({port,host:'127.0.0.1'});csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-approval-inbox-password'})).csrf;
    const cid='inbox_ui_connection',wid='inbox_ui_workflow',at=new Date().toISOString(),connection={url:origin+'/sandbox/approval-inbox',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Controlled approval browser',connection.url,'connected',store.seal(connection),at);
    const definition={contract_version:'2',effect:'retrieval',inputs:{},steps:[{op:'wait_text',selector:'#lookup',text:'Lookup ready'},{op:'click',selector:'#submit',locators:[{kind:'role',role:'button',name:'Submit controlled record'}]}],outputs:[{name:'result',selector:'#result',type:'string'}],verifiers:[{kind:'changed',output:'result'}],timeout_ms:120000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Controlled risk submission','inbox.ui.submit','draft',definition.version,store.seal(definition),null,at);
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();
    const card=()=>page.locator('.action-card').filter({has:page.getByRole('heading',{name:'Controlled risk submission',exact:true})});
    await card().getByRole('button',{name:'Edit draft',exact:true}).click();let dialog=page.getByRole('dialog');
    await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();const editor=dialog.locator('.workflow-editor');
    await editor.getByRole('region',{name:'Ordered workflow steps'}).locator('ol>li').nth(1).getByRole('button').click();
    await editor.getByRole('combobox',{name:/^Step risk classification/}).selectOption('high');
    await editor.getByRole('combobox',{name:'Workflow approval policy',exact:true}).selectOption('risk_rules');
    const policy=editor.getByRole('region',{name:'Workflow approval policy'}),rule=policy.locator('fieldset').filter({has:page.locator('legend').filter({hasText:/^Approval rule 1$/})}).first();
    await rule.getByRole('checkbox',{name:'Click',exact:true}).check();await rule.getByRole('checkbox',{name:'Critical',exact:true}).uncheck();
    await policy.getByText('Effective approval gates: steps 2.',{exact:true}).waitFor();
    for(const width of [1440,375]){
      await page.setViewportSize({width,height:1000});await policy.scrollIntoViewIfNeeded();assert.ok(await policy.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'policy controls fit '+width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    await page.setViewportSize({width:1440,height:1000});await editor.getByRole('button',{name:'Save draft',exact:true}).click();await editor.getByText('Draft saved. Run verification before publishing this revision.',{exact:true}).waitFor();
    const saved=(await call(`/studio/workflows/${wid}/editor`)).definition;assert.equal(saved.steps[1].risk,'high');assert.notEqual(saved.steps[1].approval_required,true,'configured policy, rather than explicit gate, causes the pause');assert.deepEqual(saved.approval_policy,{mode:'risk_rules',rules:[{operations:['click'],risks:['high']}]});
    async function startInUi(){
      await dialog.getByRole('button',{name:'Run verification',exact:true}).click();await dialog.getByText('Awaiting owner approval',{exact:true}).waitFor();
      const pending=(await call('/studio/approvals')).items.find(item=>item.workflow_id===wid);assert.ok(pending);assert.equal(pending.approval.step,2);assert.equal(pending.approval.context.risk,'high');
      await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Approvals',exact:true}).click();await page.getByRole('heading',{name:'Approval inbox',exact:true}).waitFor();return pending;
    }
    let pending=await startInUi();assert.equal(submissions,0,'the policy pauses the real click before mutation');const inbox=page.getByRole('region',{name:'Approval inbox'});
    await inbox.getByRole('button',{name:'Reject step',exact:true}).click();const rejected=await terminal(pending.run_id);assert.equal(rejected.approval.status,'rejected');assert.equal(submissions,0,'rejection never sends the controlled mutation');
    await inbox.getByRole('button',{name:'Approval history',exact:true}).click();await inbox.getByText('rejected',{exact:true}).waitFor();await inbox.getByText('high',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Actions',exact:true}).click();await card().getByRole('button',{name:'Test action',exact:true}).click();dialog=page.getByRole('dialog');pending=await startInUi();
    await inbox.getByRole('button',{name:'Review approval',exact:true}).waitFor();assert.equal(submissions,0);
    for(const width of [1440,375]){
      await page.setViewportSize({width,height:1000});await inbox.scrollIntoViewIfNeeded();const fit=await inbox.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,inbox:element.scrollWidth<=element.clientWidth+1}));assert.deepEqual(fit,{page:true,inbox:true},'inbox fits '+width);await page.evaluate(()=>{window.scrollTo(0,0);if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});await page.screenshot({path:join(dataDir,`pending-${width}.png`),fullPage:true});
    }
    const review=inbox.getByRole('button',{name:'Review approval',exact:true});await review.focus();await page.keyboard.press('Enter');const alert=page.getByRole('alertdialog');await alert.getByRole('button',{name:'Keep waiting',exact:true}).waitFor();assert.equal(await alert.getByRole('button',{name:'Keep waiting',exact:true}).evaluate(element=>element===document.activeElement),true,'approval confirmation defaults to the safe keyboard action');
    await page.keyboard.press('Enter');await alert.waitFor({state:'hidden'});assert.equal(submissions,0,'safe keyboard confirmation keeps waiting');
    await review.click();await page.getByRole('alertdialog').getByRole('button',{name:'Approve this step',exact:true}).click();const approved=await terminal(pending.run_id);assert.equal(approved.status,'succeeded',JSON.stringify(approved.error));assert.equal(approved.approval.status,'approved');assert.equal(submissions,1,'one owner approval permits exactly one real click');
    await inbox.getByRole('button',{name:'Approval history',exact:true}).click();await inbox.getByText('approved',{exact:true}).waitFor();assert.equal(await inbox.getByText('high',{exact:true}).count(),2);await page.screenshot({path:join(dataDir,'history-375.png'),fullPage:true});
    assert.equal((await call('/studio/approvals')).items.length,0);assert.deepEqual(errors,[]);console.log('Approval inbox UI screenshots: '+dataDir);
  }catch(error){if(page){await page.screenshot({path:join(dataDir,'failure.png'),fullPage:true});console.log('Approval inbox UI failure screenshot: '+join(dataDir,'failure.png'));console.log((await page.locator('[role=dialog],[role=alertdialog],.approval-inbox').allTextContents()).join(' ').slice(0,3000));}throw error;}finally{await browser?.close();await app.close();}
});
