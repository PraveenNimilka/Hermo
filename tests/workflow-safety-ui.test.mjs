import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('owner reviews permissions, approves a real step and manages isolated workflow keys in responsive UI',{timeout:120000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const dataDir=resolve('work/workflow-safety-ui',randomUUID());mkdirSync(dataDir,{recursive:true});
  const {app,store,origin}=await createApp({port,dataDir});let browser,page,cookie='',csrf='',submissions=0;
  app.get('/sandbox/safety-ui',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Workflow safety fixture</title><p id="lookup">Lookup ready</p><button id="submit" aria-label="Submit record">Submit record</button><p id="result">Waiting</p><script src="/sandbox/safety-ui.js"></script>'));
  app.get('/sandbox/safety-ui.js',async(_,reply)=>reply.type('text/javascript').send("document.querySelector('#submit').addEventListener('click',async()=>{await fetch('/sandbox/safety-ui-observed');document.querySelector('#result').textContent='Submitted';});"));
  app.get('/sandbox/safety-ui-observed',async()=>{submissions++;return {ok:true};});
  async function call(path,body,headers={}){
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  }
  // This fixture owner explicitly reviews and authorizes configured publication changes.
  async function ok(...args){if(args[1]!==undefined&&/^\/studio\/workflows\/[^/]+\/publish$/.test(args[0])){const review=await ok(args[0].replace(/\/publish$/,'/permissions'));args[1]={expected_version:review.version,permission_fingerprint:review.fingerprint,...(review.changes?.breaking?{change_fingerprint:review.changes.fingerprint,accept_breaking:true}:{}),...args[1]};}const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;}
  async function observe(id,predicate){for(let n=0;n<400;n++){const run=await ok('/studio/runs/'+id);if(predicate(run))return run;await new Promise(done=>setTimeout(done,50));}assert.fail('Run did not reach expected state');}
  const terminal=id=>observe(id,run=>['succeeded','failed','cancelled'].includes(run.status));
  const authorization=key=>({authorization:'Bearer '+key,cookie:''});
  const acknowledgment='I reviewed this workflow’s permissions and possible website effects.';
  try{
    await app.listen({port,host:'127.0.0.1'});csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-safety-ui-password'})).csrf;
    const cid='safety_ui_connection',at=new Date().toISOString(),connection={url:origin+'/sandbox/safety-ui',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Safety fixture browser',connection.url,'connected',store.seal(connection),at);
    function seed(id,name,steps){const definition={contract_version:'2',effect:'retrieval',inputs:{},steps,outputs:[{name:'result',selector:'#result',type:'string'}],verifiers:[{kind:steps.length?'changed':'nonempty',output:'result'}],timeout_ms:60000};definition.version=hash(JSON.stringify(definition));store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(id,cid,name,id.replaceAll('_','.'),'draft',definition.version,store.seal(definition),null,at);return definition;}
    const wid='safety_ui_submit';seed(wid,'Reviewed submission',[{op:'wait_text',selector:'#lookup',text:'Lookup ready'},{op:'click',selector:'#submit',locators:[{kind:'role',role:'button',name:'Submit record'}]}]);
    seed('safety_ui_read','Independent lookup',[]);
    const initial=await terminal((await ok(`/studio/workflows/${wid}/test`,{input:{}})).run_id);assert.equal(initial.status,'succeeded',JSON.stringify(initial.error));assert.equal(submissions,1);
    assert.equal((await terminal((await ok('/studio/workflows/safety_ui_read/test',{input:{}})).run_id)).status,'succeeded');
    const independent=await ok('/studio/workflows/safety_ui_read/publish',{});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();
    const card=()=>page.locator('.action-card').filter({has:page.getByRole('heading',{name:'Reviewed submission',exact:true})});
    await card().getByRole('button',{name:'Edit draft',exact:true}).click();let dialog=page.getByRole('dialog'),publish=dialog.getByRole('button',{name:'Publish API',exact:true});
    await dialog.getByRole('checkbox',{name:acknowledgment}).waitFor();assert.equal(await publish.isDisabled(),true,'permission acknowledgment is required despite a verified draft');
    await dialog.getByRole('checkbox',{name:acknowledgment}).check();assert.equal(await publish.isEnabled(),true);
    await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();const editor=dialog.locator('.workflow-editor');
    await editor.getByRole('region',{name:'Ordered workflow steps'}).locator('ol>li').nth(1).getByRole('button').click();
    await editor.getByRole('checkbox',{name:/Pause for owner approval before this step/}).check();
    await editor.getByRole('button',{name:'Save draft',exact:true}).click();await editor.getByText('Draft saved. Run verification before publishing this revision.',{exact:true}).waitFor();
    assert.equal((await ok(`/studio/workflows/${wid}/editor`)).definition.steps[1].approval_required,true,'approval opt-in persists through the real editor');
    assert.equal((await ok('/studio/overview')).workflows.find(item=>item.id===wid).tested,false,'editing invalidates prior verification');
    assert.equal(await dialog.getByRole('checkbox',{name:acknowledgment}).isChecked(),false,'saved definition resets permission acknowledgment');assert.equal(await publish.isDisabled(),true);
    await dialog.getByRole('button',{name:'Run verification',exact:true}).click();
    await dialog.getByText('Awaiting owner approval',{exact:true}).waitFor();
    const run=(await ok('/studio/overview')).runs.find(item=>item.workflow_id===wid&&item.phase==='awaiting_approval');assert.ok(run);assert.equal(submissions,1,'preview and pending approval do not submit');
    await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Runs',exact:true}).click();
    await page.getByRole('button',{name:`Inspect run ${run.id}`,exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Review approval',exact:true}).click();let alert=page.getByRole('alertdialog');
    await alert.getByRole('button',{name:'Keep waiting',exact:true}).waitFor();assert.equal(await alert.getByRole('button',{name:'Keep waiting',exact:true}).evaluate(element=>element===document.activeElement),true,'safe option receives keyboard focus');
    await page.keyboard.press('Enter');await alert.waitFor({state:'hidden'});assert.equal(submissions,1);assert.equal((await ok('/studio/runs/'+run.id)).approval.status,'pending');
    await dialog.getByRole('button',{name:'Review approval',exact:true}).click();alert=page.getByRole('alertdialog');await alert.getByRole('button',{name:'Approve this step',exact:true}).click();
    assert.equal((await terminal(run.id)).status,'succeeded');assert.equal(submissions,2,'one approval executes exactly one click');
    await dialog.getByText('Result verified',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Actions',exact:true}).click();await card().getByRole('button',{name:'Test action',exact:true}).click();dialog=page.getByRole('dialog');publish=dialog.getByRole('button',{name:'Publish API',exact:true});
    await dialog.getByRole('checkbox',{name:acknowledgment}).check();await publish.click();await page.getByRole('heading',{name:'Your action is ready.',exact:true}).waitFor();
    const firstKey=await page.locator('.secret-box code').textContent();assert.ok(firstKey?.startsWith('hm_live_'));assert.equal((await call('/v1/action-contract',undefined,authorization(firstKey))).status,200);
    await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.getByText(firstKey,{exact:true}).count(),0,'new key is removed after closing its one-time reveal');
    const sibling=await ok('/studio/keys',{workflow_id:wid,name:'Sibling integration'}),revokable=await ok('/studio/keys',{workflow_id:wid,name:'Disposable integration'});
    await card().getByRole('button',{name:'Test action',exact:true}).click();dialog=page.getByRole('dialog');const keys=dialog.getByRole('region',{name:'Workflow API keys'}),permissions=dialog.getByRole('region',{name:'Workflow permissions'});
    await keys.getByText('Disposable integration',{exact:true}).waitFor();assert.equal((await keys.textContent()).includes(firstKey),false,'key management never exposes stored secrets');
    for(const width of [1440,375]){
      await page.setViewportSize({width,height:1000});
      for(const [name,panel]of [['permissions',permissions],['keys',keys]]){
        await panel.evaluate(element=>element.scrollIntoView({block:'start'}));
        const fit=await panel.evaluate(element=>{const bounds=element.getBoundingClientRect();return {page:document.documentElement.scrollWidth<=innerWidth+1,panel:element.scrollWidth<=element.clientWidth+1,left:bounds.left>=0,right:bounds.right<=innerWidth+1,dialog:[...document.querySelectorAll('[role=dialog]')].every(node=>node.scrollWidth<=node.clientWidth+1)};});
        assert.deepEqual(fit,{page:true,panel:true,left:true,right:true,dialog:true},`${name} fits ${width}px`);
        await page.screenshot({path:join(dataDir,`${name}-${width}.png`)});
      }
    }
    await page.setViewportSize({width:1440,height:1000});
    await keys.getByRole('button',{name:'Revoke key Disposable integration',exact:true}).click();alert=page.getByRole('alertdialog');await alert.getByRole('button',{name:'Cancel',exact:true}).waitFor();
    assert.equal(await alert.getByRole('button',{name:'Cancel',exact:true}).evaluate(element=>element===document.activeElement),true);await page.keyboard.press('Enter');await alert.waitFor({state:'hidden'});
    assert.equal((await call('/v1/action-contract',undefined,authorization(revokable.key))).status,200,'cancelled revocation leaves the key valid');
    await keys.getByRole('button',{name:'Revoke key Disposable integration',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Revoke key',exact:true}).click();
    await keys.getByText('Revoked',{exact:true}).waitFor();assert.equal((await call('/v1/action-contract',undefined,authorization(revokable.key))).status,401);
    await keys.getByRole('button',{name:'Rotate key Reviewed submission key',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Rotate key',exact:true}).click();
    await page.getByRole('heading',{name:'Your action is ready.',exact:true}).waitFor();const replacement=await page.locator('.secret-box code').textContent();assert.ok(replacement?.startsWith('hm_live_'));assert.notEqual(replacement,firstKey);
    assert.equal((await call('/v1/action-contract',undefined,authorization(firstKey))).status,401);assert.equal((await call('/v1/action-contract',undefined,authorization(replacement))).status,200);
    assert.equal((await call('/v1/action-contract',undefined,authorization(sibling.key))).status,200);assert.equal((await call('/v1/action-contract',undefined,authorization(independent.key))).status,200,'other workflow on the same browser keeps access');
    await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.getByText(replacement,{exact:true}).count(),0);
    assert.equal((await ok('/studio/overview')).connections.find(item=>item.id===cid).status,'connected');assert.equal(submissions,2);assert.deepEqual(errors,[]);
    console.log('Workflow safety UI screenshots: '+dataDir);
  }catch(error){if(page){await page.screenshot({path:join(dataDir,'failure.png')});console.log('Workflow safety UI failure screenshot: '+join(dataDir,'failure.png'));console.log((await page.locator('[role=dialog],[role=alertdialog]').allTextContents()).join(' ').slice(0,3000));}throw error;}finally{await browser?.close();await app.close();}
});
