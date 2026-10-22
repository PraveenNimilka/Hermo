import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('owner verification and scoped playground expose uncertain outcomes and require explicit safe retry acknowledgment',{timeout:100000},async()=>{
  const previousMasterKey=process.env.HERMO_MASTER_KEY;
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const dataDir=resolve('work/execution-receipt-ui',randomUUID());mkdirSync(dataDir,{recursive:true});
  let executions=0;
  // This deliberately failing adapter exercises actual dashboard/admission/
  // worker/protocol behavior. It simulates an issued action; it does not claim
  // that a website mutation occurred or prove a real website integration.
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_connection,_definition,_input,progress)=>{
    executions++;progress(0,1);progress(0,1,{phase:'issuing'});throw Error('TIMEOUT');
  }};
  let state,browser,page,cookie='',csrf='';
  const errors=[];
  try{
    state=await createApp({port,dataDir,browserEngineFactory:async()=>engine});
    const {app,store,origin}=state;
    const call=async(path,body)=>{
      const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});
      if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
      assert.ok(response.statusCode<300,response.body);return response.json();
    };
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-uncertain-ui-owner'})).csrf;
    const at=new Date().toISOString(),cid='receipt_ui_connection';
    const connection={url:origin+'/sandbox/receipt-fixture',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Receipt fixture browser',connection.url,'connected',store.seal(connection),at);
    const seed=(id,name,status)=>{
      const definition={contract_version:'2',effect:'retrieval',inputs:{query:{type:'string',required:true,example:'first'}},steps:[{op:'click',selector:'#fixture-search'}],outputs:[{name:'answer',selector:'#fixture-answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],timeout_ms:15000};definition.version=hash(JSON.stringify(definition));
      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(id,cid,name,id.replaceAll('_','.'),status,definition.version,store.seal(definition),status==='published'?definition.version:null,at);
    };
    seed('receipt_ui_draft','Uncertain verification fixture','draft');seed('receipt_ui_published','Uncertain API fixture','published');
    const key='hm_live_'+randomBytes(32).toString('base64url');
    store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('receipt_ui_key','Controlled browser test',hash(key),key.slice(-6),'receipt_ui_published','2099-01-01T00:00:00Z',null,at);
    const count=wid=>store.db.prepare('SELECT count(*) n FROM runs WHERE workflow_id=?').get(wid).n;
    await app.listen({port,host:'127.0.0.1'});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    const fit=async(panel,label)=>{
      for(const width of [1440,375]){
        await page.setViewportSize({width,height:1000});await panel.evaluate(element=>element.scrollIntoView({block:'center'}));
        const geometry=await panel.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,panel:element.scrollWidth<=element.clientWidth+1,dialogs:[...document.querySelectorAll('[role=dialog]')].every(dialog=>dialog.scrollWidth<=dialog.clientWidth+1)}));
        assert.deepEqual(geometry,{page:true,panel:true,dialogs:true},`${label} fits ${width}px`);
        await page.screenshot({path:join(dataDir,`${label}-${width}.png`)});
      }
    };
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();
    const card=page.locator('.action-card').filter({has:page.getByRole('heading',{name:'Uncertain verification fixture',exact:true})});
    await card.getByRole('button',{name:'Edit draft',exact:true}).click();
    const dialog=page.getByRole('dialog'),verify=dialog.getByRole('button',{name:'Run verification',exact:true});
    await dialog.getByLabel('query',{exact:true}).fill('first');await verify.click();
    const ownerAcknowledgment=dialog.getByRole('checkbox',{name:'I inspected the website and authorize another verification. It may repeat a website change.',exact:true});
    await ownerAcknowledgment.waitFor();await page.waitForFunction(()=>document.querySelector('.test-result .pill')?.textContent?.trim()==='uncertain');
    assert.equal(await verify.isDisabled(),true);assert.equal(count('receipt_ui_draft'),1);assert.equal(executions,1);
    const firstOwner=(await call('/studio/overview')).runs.find(run=>run.workflow_id==='receipt_ui_draft');
    assert.equal(firstOwner.status,'failed');assert.equal(firstOwner.execution_status,'uncertain');assert.equal(firstOwner.result,undefined);
    assert.equal(await dialog.locator('.test-result pre').count(),0,'uncertain owner result never renders successful output');
    await fit(dialog,'owner-uncertain');
    await ownerAcknowledgment.focus();await page.keyboard.press('Space');assert.equal(await ownerAcknowledgment.isChecked(),true);assert.equal(await verify.isEnabled(),true);
    await verify.click();await page.waitForFunction(()=>{const box=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')].find(element=>element.closest('label')?.textContent?.includes('I inspected the website'));return box&&!box.checked&&document.querySelector('.test-result .pill')?.textContent?.trim()==='uncertain';});
    assert.equal(count('receipt_ui_draft'),2);assert.equal(executions,2);assert.equal(await verify.isDisabled(),true);assert.equal(await ownerAcknowledgment.isChecked(),false);
    await page.setViewportSize({width:1440,height:1000});await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'API docs',exact:true}).click();await page.getByLabel('Action',{exact:true}).selectOption('receipt_ui_published');
    const playground=page.locator('.api-playground');
    await playground.getByLabel('Scoped API key',{exact:true}).fill(key);await playground.getByRole('button',{name:'Connect key',exact:true}).click();
    await playground.getByText('Scoped key verified. Requests use the consumer API and its published contract.',{exact:true}).waitFor();
    assert.equal(await playground.getByLabel('Scoped API key',{exact:true}).inputValue(),'');
    await playground.getByLabel('query',{exact:true}).fill('api-first');const submit=playground.getByRole('button',{name:'Run API request',exact:true});await submit.click();
    const consumerAcknowledgment=playground.getByRole('checkbox',{name:/I inspected the website outcome of .* and authorize another execution/});
    await consumerAcknowledgment.waitFor();assert.equal(await submit.isDisabled(),true);
    const response=JSON.parse(await playground.getByLabel('API response JSON',{exact:true}).textContent());
    assert.equal(response.status,'failed');assert.equal(response.execution_status,'uncertain');assert.equal(response.result,undefined);
    assert.equal((await playground.locator('.api-playground-status dd').first().textContent()).trim(),'uncertain');
    assert.equal(count('receipt_ui_published'),1);assert.equal(executions,3);
    // Editing creates a new request draft but must preserve the unresolved
    // website-outcome warning and require fresh permission to repeat effects.
    await playground.getByLabel('query',{exact:true}).fill('api-edited');
    assert.equal(await playground.getByLabel('API response JSON',{exact:true}).count(),0);
    assert.equal(await consumerAcknowledgment.isVisible(),true);assert.equal(await consumerAcknowledgment.isChecked(),false);assert.equal(await submit.isDisabled(),true);
    assert.equal(count('receipt_ui_published'),1,'input changes do not admit another request');
    await fit(playground,'playground-retry-guard');
    await consumerAcknowledgment.focus();await page.keyboard.press('Space');assert.equal(await submit.isEnabled(),true);await submit.click();
    await consumerAcknowledgment.waitFor();await page.waitForFunction(()=>{const status=document.querySelector('.api-playground-status dd'),box=document.querySelector('.api-playground-controls input[type=checkbox]');return status?.textContent?.trim()==='uncertain'&&box&&!box.checked;});
    const repeated=JSON.parse(await playground.getByLabel('API response JSON',{exact:true}).textContent());
    assert.notEqual(repeated.id,response.id);assert.equal(count('receipt_ui_published'),2);assert.equal(executions,4);assert.equal(await submit.isDisabled(),true);
    const consumerRows=store.db.prepare('SELECT payload FROM runs WHERE workflow_id=? ORDER BY created_at,id').all('receipt_ui_published').map(row=>store.unseal(row.payload));
    assert.deepEqual(consumerRows.map(row=>row.input.query),['api-first','api-edited']);
    const storage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));assert.equal(JSON.stringify(storage).includes(key),false);
    assert.equal((await page.content()).includes(key),false);assert.deepEqual(errors,[]);
    console.log('Execution receipt UI screenshots: '+dataDir);
  }catch(error){if(page){await page.screenshot({path:join(dataDir,'failure.png')});console.log('Execution receipt UI failure screenshot: '+join(dataDir,'failure.png'));console.log((await page.locator('[role=dialog],.api-playground').allTextContents()).join(' ').slice(0,3500));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previousMasterKey===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMasterKey;}
});
