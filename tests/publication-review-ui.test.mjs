import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {verifyResult} from '../server/verification.mjs';

test('publication and rollback UI require separate contract consent and preserve immutable revisions',{timeout:90000},async()=>{
  const previousMasterKey=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const dataDir=resolve('work/publication-review-ui',randomUUID());mkdirSync(dataDir,{recursive:true});
  // The actual built dashboard, runtime, review and database are exercised.
  // Website extraction is deterministic here; no live-site claim is made.
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_connection,definition,input,progress)=>{
    for(let index=0;index<definition.steps.length;index++){progress(index,definition.steps.length);progress(index,definition.steps.length,{phase:'completed'});}
    progress(definition.steps.length,definition.steps.length,{phase:'verifying'});
    const result=Object.fromEntries(definition.outputs.map(field=>[field.name,'Observed controlled result']));
    return {result,verification:verifyResult(definition,result,input,'controlled_publication_ui_adapter')};
  }};
  let state,browser,page,cookie='',csrf='';const errors=[];
  try{
    state=await createApp({port,dataDir,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{
      const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});
      if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();
    };
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-publication-review-ui-owner'})).csrf;
    const at=new Date().toISOString(),wid='wf_publication_review_ui',base='/studio/workflows/'+wid,cid='conn_publication_review_ui';
    const definition={contract_version:'2',steps:[],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
    const config={url:origin+'/sandbox/publication-review',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Controlled review browser',config.url,'connected',store.seal(config),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Contract review fixture','review.ui.fixture','draft',definition.version,store.seal(definition),null,at);
    const run=async()=>{
      const receipt=await call(base+'/test',{input:{}}),deadline=Date.now()+10000;
      while(Date.now()<deadline){const result=await call('/studio/runs/'+receipt.run_id);if(result.status==='succeeded')return;assert.notEqual(result.status,'failed',JSON.stringify(result));await new Promise(done=>setTimeout(done,20));}assert.fail('Controlled verification did not finish');
    };
    await run();const initialReview=await call(base+'/permissions');await call(base+'/publish',{expected_version:initialReview.version,permission_fingerprint:initialReview.fingerprint});
    const original=store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid);
    await call(base+'/draft',{expected_version:definition.version});const editable=await call(base+'/editor');
    const changed=await call(base+'/editor',{expected_version:editable.version,steps:[],inputs:{},outputs:[{name:'response',selector:'#response',type:'string'}],verifiers:[{kind:'nonempty',output:'response'}],timeout_seconds:45});await run();
    await app.listen({host:'127.0.0.1',port});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    const fit=async(panel,label)=>{
      for(const width of [1440,375]){
        await page.setViewportSize({width,height:1000});await panel.evaluate(element=>element.scrollIntoView({block:'start'}));
        const geometry=await panel.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,panel:element.scrollWidth<=element.clientWidth+1,dialogs:[...document.querySelectorAll('[role=dialog]')].every(dialog=>dialog.scrollWidth<=dialog.clientWidth+1)}));
        assert.deepEqual(geometry,{page:true,panel:true,dialogs:true},`${label} fits ${width}px`);await page.screenshot({path:join(dataDir,`${label}-${width}.png`)});
      }
    };
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Test action',exact:true}).click();
    const verifyDialog=page.getByRole('dialog',{name:'Verify your action',exact:true}),changes=verifyDialog.getByRole('region',{name:'Publication changes',exact:true});
    await changes.getByText('This changes the API contract. Existing clients may need updating.',{exact:true}).waitFor();
    assert.ok(await changes.getByText('outputs.answer',{exact:true}).count()>0);assert.ok(await changes.getByText('outputs.response',{exact:true}).count()>0);assert.match(await changes.textContent(),/field removed/);assert.match(await changes.textContent(),/field added/);
    const publish=verifyDialog.getByRole('button',{name:'Publish draft revision',exact:true}),permissions=verifyDialog.getByRole('checkbox',{name:'I reviewed this workflow’s permissions and possible website effects.',exact:true}),contract=verifyDialog.getByRole('checkbox',{name:'I reviewed the breaking API contract changes and will update affected clients.',exact:true});
    assert.equal(await publish.isDisabled(),true);await permissions.check();assert.equal(await publish.isDisabled(),true,'Ordinary website permission consent does not accept a breaking API contract');
    assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(wid).revision,1);
    await fit(changes,'publication-contract-review');await contract.focus();await page.keyboard.press('Space');assert.equal(await publish.isEnabled(),true);
    await publish.click();await page.getByRole('heading',{name:'Your action is ready.',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(wid).revision,2);
    assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid),original);
    const draftBefore=store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(wid);assert.equal(draftBefore.version,changed.version);
    await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Version history',exact:true}).click();
    const history=page.getByRole('dialog',{name:'Workflow versions',exact:true});await history.getByRole('button',{name:'Roll back live API to revision 1',exact:true}).click();
    const rollback=page.getByRole('alertdialog',{name:'Change the live API revision?',exact:true}),confirm=rollback.getByRole('button',{name:'Confirm rollback',exact:true});
    await rollback.waitFor();await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Cancel');
    assert.equal(await rollback.getByRole('button',{name:'Cancel',exact:true}).evaluate(element=>element===document.activeElement),true,'Keyboard focus starts on the safe Cancel action');
    await rollback.getByRole('region',{name:'Publication changes',exact:true}).getByText('This changes the API contract. Existing clients may need updating.',{exact:true}).waitFor();
    assert.equal(await confirm.isDisabled(),true);const rollbackConsent=rollback.getByRole('checkbox',{name:'I reviewed this revision’s contract and website permissions and authorize changing the live API.',exact:true});
    assert.equal(await rollbackConsent.isChecked(),false);await fit(rollback,'rollback-contract-consent');
    assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(wid).revision,2);
    await rollbackConsent.focus();await page.keyboard.press('Space');assert.equal(await confirm.isEnabled(),true);await confirm.click();
    await history.getByText('The live API now uses revision 1.',{exact:true}).waitFor();
    assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(wid).revision,1);
    assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflows WHERE id=?').get(wid),draftBefore,'Rollback preserves the revision 2 working definition');
    assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid),original);
    assert.deepEqual(errors,[]);console.log('Publication review UI screenshots: '+dataDir);
  }catch(error){if(page){await page.screenshot({path:join(dataDir,'failure.png')});console.log('Publication review UI failure screenshot: '+join(dataDir,'failure.png'));console.log((await page.locator('[role=dialog]').allTextContents()).join(' ').slice(0,4500));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previousMasterKey===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMasterKey;}
});
