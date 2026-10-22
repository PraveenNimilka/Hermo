import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('locator repair UI requires a current probe and explicit consent, preserving all nonlocator draft fields',{timeout:90000},async()=>{
  const previousMaster=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/locator-repair-ui',randomUUID());mkdirSync(directory,{recursive:true});
  // This exercises the production-built dashboard, owner routes and store.
  // DOM observations are controlled fixture data, not a live website claim.
  const documentId=randomUUID(),elementId=randomUUID(),observations=[];
  let browserOpen=false,openCalls=0;
  const candidate={element_id:elementId,selector:'#current-search',locators:[{kind:'testId',value:'catalogue-search'},{kind:'role',role:'button',name:'Search'}],role:'button',name:'Search',score:95,reasons:['EXACT_SEMANTIC_MATCH','OPERATION_COMPATIBLE']};
  const engine={isOpen:()=>browserOpen,isPairing:()=>false,closeAll:async()=>{},closeStudios:async()=>{},open:async()=>{openCalls++;browserOpen=true;},probeTarget:async(cid,payload,framePath)=>{
    observations.push({cid,payload:structuredClone(payload),framePath:structuredClone(framePath)});
    if(payload.mode==='candidates')return {document_id:documentId,matches:0,visible:false,enabled:false,semantic_match:false,candidates:[candidate]};
    assert.equal(payload.mode,'probe');assert.equal(payload.selector,candidate.selector);
    return {document_id:documentId,element_id:elementId,matches:1,visible:true,enabled:true,semantic_match:true,role:'button',name:'Search'};
  }};
  let state,browser,page,cookie='',csrf='';const errors=[];
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-locator-repair-ui-owner'})).csrf;
    const at=new Date().toISOString(),cid='conn_locator_repair_ui',wid='wf_locator_repair_ui',url=origin+'/sandbox/locator-repair-ui';
    const definition={contract_version:'2',steps:[{id:'step_query_input',op:'fill',selector:'#query',parameter:'query',risk:'low',label:'Search query'},{id:'step_search_button',op:'click',selector:'#outdated-search',locators:[{kind:'role',role:'button',name:'Search'}],approval_required:true,risk:'high',label:'Search catalogue'}],approval_policy:{mode:'selected_steps',steps:[2]},inputs:{query:{type:'string',required:true,maxLength:160}},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Repair browser fixture',url,'connected',store.seal({url,origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Locator repair fixture','locator.repair.ui','published',definition.version,store.seal(definition),definition.version,at);
    await call('/studio/overview');
    const revision=store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid),connectionBefore=store.db.prepare('SELECT payload,status FROM connections WHERE id=?').get(cid);
    await app.listen({host:'127.0.0.1',port});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Verify your action',exact:true});await dialog.getByText('Edit workflow steps and extraction',{exact:true}).click();
    const editor=dialog.locator('.workflow-editor'),configuration=editor.getByRole('region',{name:'Selected step configuration',exact:true});await editor.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();await editor.locator('.workflow-editor-timeline li button').nth(1).click();
    const repair=configuration.locator('.locator-repair');await repair.locator('summary').click();assert.equal(observations.length,0,'Opening repair controls never inspects or opens the browser automatically');
    const original=store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid);
    const inspect=repair.getByRole('button',{name:'Inspect current target',exact:true});await inspect.click();
    await repair.getByRole('alert').filter({hasText:'Open and confirm this workflow’s authorized browser before inspecting its target.'}).waitFor();assert.equal(await inspect.isEnabled(),true);assert.equal(observations.length,0);assert.equal(openCalls,0,'Inspection cannot reopen a closed browser');
    browserOpen=true;await inspect.click();await repair.getByRole('radio').waitFor();assert.equal(observations.length,1);
    await repair.getByRole('radio').focus();await page.keyboard.press('Space');
    const comparison=repair.locator('.locator-repair-comparison');await comparison.waitFor();assert.match(await comparison.textContent(),/#outdated-search/);assert.match(await comparison.textContent(),/#current-search/);assert.match(await repair.textContent(),/Evidence score 95 \/ 100/);assert.match(await repair.textContent(),/do not establish that an action is safe/);
    const apply=repair.getByRole('button',{name:'Apply locators to draft',exact:true}),consent=repair.getByRole('checkbox',{name:'I reviewed this target change and authorize applying only its locators to this draft.',exact:true});
    assert.equal(await apply.isDisabled(),true);assert.equal(await consent.isDisabled(),true);
    await repair.getByRole('button',{name:'Probe selected candidate',exact:true}).click();await repair.getByText('One visible, enabled target matches the proposed locator checks. Review its locator change before applying.',{exact:true}).waitFor();
    assert.equal(await consent.isEnabled(),true);assert.equal(await apply.isDisabled(),true);assert.deepEqual(store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid),original,'Inspect and probe do not rewrite the draft');assert.equal(observations.length,2);
    const fit=async(label,target)=>{for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await target.evaluate(element=>element.scrollIntoView({block:'start'}));const bounds=await repair.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,panel:element.scrollWidth<=element.clientWidth+1,dialogs:[...document.querySelectorAll('[role=dialog]')].every(item=>item.scrollWidth<=item.clientWidth+1)}));assert.deepEqual(bounds,{page:true,panel:true,dialogs:true},`${label} fits ${width}px`);await page.screenshot({path:join(directory,`${label}-${width}.png`)});}};
    await fit('locator-repair-probe',comparison);await consent.focus();await page.keyboard.press('Space');assert.equal(await apply.isEnabled(),true);
    await fit('locator-repair-consent',consent);
    const appliedResponse=page.waitForResponse(response=>response.url()===origin+`/studio/workflows/${wid}/locator-repair/apply`&&response.request().method()==='POST');await apply.click();assert.equal((await appliedResponse).status(),200);
    await page.waitForFunction(()=>[...document.querySelectorAll('.workflow-editor-config input')].some(input=>input.value==='#current-search'));
    const changed=store.db.prepare('SELECT payload,version,test_version FROM workflows WHERE id=?').get(wid),stored=store.unseal(changed.payload);assert.notEqual(changed.version,definition.version);assert.equal(changed.test_version,null);
    const {version:oldVersion,...before}=definition,{version:newVersion,...after}=stored;const expected=structuredClone(before);expected.steps[1].selector=candidate.selector;expected.steps[1].locators=candidate.locators;
    assert.deepEqual(after,expected,'Only the saved target locators change; step IDs, operation, approval, risk, input binding, schemas and policy are preserved');assert.equal(newVersion,changed.version);
    assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(wid),revision);assert.equal(store.db.prepare('SELECT revision FROM workflow_publications WHERE workflow_id=?').get(wid).revision,1);assert.deepEqual(store.db.prepare('SELECT payload,status FROM connections WHERE id=?').get(cid),connectionBefore);
    assert.equal(observations.length,3,'Apply rechecks the observation through the actual backend before saving');assert.equal(observations.every(value=>['probe','candidates'].includes(value.payload.mode)),true);assert.equal(openCalls,0);assert.deepEqual(errors,[]);console.log('Locator repair UI screenshots: '+directory);
  }catch(error){if(page){await page.screenshot({path:join(directory,'failure.png')});console.log('Locator repair UI failure screenshot: '+join(directory,'failure.png'));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previousMaster===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMaster;}
});
