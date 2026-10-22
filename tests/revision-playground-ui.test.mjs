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
import {convertOutputs} from '../server/workflow-contract.mjs';

test('scoped playground selects immutable revision schemas and preserves pinned request recovery and unsafe retry consent',{timeout:100000},async()=>{
  const previousMasterKey=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const dataDir=resolve('work/revision-playground-ui',randomUUID());mkdirSync(dataDir,{recursive:true});
  let state,browser,page,cookie='',csrf='',behavior='success',release;
  const executed=[],requests=[],errors=[];
  // Real dashboard, encrypted revisions, queue and consumer routes, with a
  // deterministic browser boundary. This does not assert live website behavior.
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_connection,definition,input,progress,signal)=>{
    executed.push({version:definition.version,input});progress(0,1);
    if(behavior==='pending')await new Promise((done,reject)=>{release=done;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
    if(behavior==='uncertain'){progress(0,1,{phase:'issuing'});throw Error('TIMEOUT');}
    progress(0,1,{phase:'completed'});progress(1,1,{phase:'verifying'});
    const raw={value:String(input.quantity)};return {result:convertOutputs(definition.outputs,raw),verification:verifyResult(definition,raw,input,'controlled_revision_ui')};
  }};
  try{
    state=await createApp({port,dataDir,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{
      const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});
      if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();
    };
    const finish=async id=>{for(let n=0;n<250;n++){const run=await call('/studio/runs/'+id);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(done=>setTimeout(done,20));}assert.fail('Fixture run did not finish');};
    const publish=async()=>{const review=await call(base+'/permissions');return call(base+'/publish',{expected_version:review.version,permission_fingerprint:review.fingerprint,...review.changes?.breaking?{accept_breaking:true,change_fingerprint:review.changes.fingerprint}:{}});};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-revision-playground-owner'})).csrf;
    const wid='revision_playground',cid='revision_playground_connection',base='/studio/workflows/'+wid,slug='revision.playground',at=new Date().toISOString();
    const connection={url:origin+'/sandbox/revision-playground',origins:[origin],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Revision UI fixture browser',connection.url,'connected',store.seal(connection),at);
    const definition={contract_version:'2',effect:'retrieval',inputs:{quantity:{type:'number',required:true,example:11}},steps:[{op:'click',selector:'#fixture-read'}],outputs:[{name:'value',type:'number',selector:'#fixture-value'}],verifiers:[{kind:'nonempty',output:'value'}],timeout_ms:15000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Published revision UI fixture',slug,'draft',definition.version,store.seal(definition),null,at);
    assert.equal((await finish((await call(base+'/test',{input:{quantity:11}})).run_id)).status,'succeeded');const first=await publish();
    await call(base+'/draft',{expected_version:first.workflow.version});
    await call(base+'/contract',{expected_version:first.workflow.version,inputs:{quantity:{type:'string',required:true,example:'twenty-two'}},outputs:[{name:'value',type:'string'}]});
    assert.equal((await finish((await call(base+'/test',{input:{quantity:'twenty-two'}})).run_id)).status,'succeeded');await publish();
    const consumerCount=()=>store.db.prepare("SELECT count(*) n FROM runs WHERE workflow_id=? AND consumer_id!='studio'").get(wid).n;
    await app.listen({port,host:'127.0.0.1'});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/v1/actions/'))requests.push({path:new URL(request.url()).pathname,body:request.postDataJSON(),idempotency:request.headers()['idempotency-key']});});
    await page.goto(origin);await page.getByRole('button',{name:'API docs',exact:true}).click();
    const playground=page.locator('.api-playground'),selector=playground.getByLabel('Published revision',{exact:true}),submit=playground.getByRole('button',{name:'Run API request',exact:true});
    await playground.getByLabel('Scoped API key',{exact:true}).fill(first.key);await playground.getByRole('button',{name:'Connect key',exact:true}).click();await selector.waitFor();
    assert.equal(await selector.inputValue(),'active');assert.equal(await selector.locator('option').count(),3);assert.equal(await playground.getByLabel('quantity',{exact:true}).evaluate(element=>element.tagName),'TEXTAREA');
    await playground.getByLabel('quantity',{exact:true}).fill('active-string');await submit.click();await playground.getByText('Verified result received.',{exact:true}).waitFor();
    const current=JSON.parse(await playground.getByLabel('API response JSON',{exact:true}).textContent());assert.equal(current.workflow_revision,2);assert.deepEqual(current.result,{value:'active-string'});assert.equal(requests.at(-1).path,`/v1/actions/${slug}/versions/1/runs`);assert.equal(requests.at(-1).body.expected_revision,2);
    await selector.selectOption('1');await playground.getByText('Revision 1 loaded. Review its inputs before running.',{exact:true}).waitFor();
    const numeric=playground.getByLabel('quantity',{exact:true});assert.equal(await numeric.getAttribute('type'),'number');await numeric.fill('17');
    assert.match(await playground.getByLabel('curl example',{exact:true}).textContent(),/\/revisions\/1\/runs/);
    await submit.click();await playground.getByText('Verified result received.',{exact:true}).waitFor();
    const historical=JSON.parse(await playground.getByLabel('API response JSON',{exact:true}).textContent());assert.equal(historical.workflow_revision,1);assert.deepEqual(historical.result,{value:17});assert.deepEqual(requests.at(-1).body,{input:{quantity:17}});
    assert.equal(requests.at(-1).path,`/v1/actions/${slug}/revisions/1/runs`);
    await selector.selectOption('2');await playground.getByText('Revision 2 loaded. Review its inputs before running.',{exact:true}).waitFor();
    await playground.getByLabel('quantity',{exact:true}).fill('pinned-string');behavior='pending';
    const explicitPattern=`**/v1/actions/${slug}/revisions/2/runs`;let lostReceipt=true;
    await page.route(explicitPattern,async route=>{if(!lostReceipt){await route.continue();return;}lostReceipt=false;const accepted=await route.fetch();assert.equal(accepted.status(),202);await route.abort('failed');});
    const beforePending=consumerCount();await submit.click();await playground.getByRole('button',{name:'Retry same request',exact:true}).waitFor();
    assert.equal(await selector.isDisabled(),true,'unknown receipt pins the selected revision');assert.equal(await playground.getByLabel('quantity',{exact:true}).isDisabled(),true);
    assert.equal(consumerCount(),beforePending+1);const originalRequest=requests.at(-1);
    await playground.getByRole('button',{name:'Retry same request',exact:true}).click();await playground.getByRole('button',{name:'Stop waiting',exact:true}).waitFor();
    assert.equal(await selector.isDisabled(),true,'accepted pending execution keeps revision selection disabled');
    await playground.getByRole('button',{name:'Stop waiting',exact:true}).click();await playground.getByRole('button',{name:'Resume checking run',exact:true}).waitFor();assert.equal(await selector.isDisabled(),true);
    assert.deepEqual(requests.at(-1),originalRequest,'lost receipt recovery preserves route, input and idempotency');assert.equal(consumerCount(),beforePending+1,'recovery does not submit twice');
    for(let n=0;n<100&&typeof release!=='function';n++)await new Promise(done=>setTimeout(done,20));
    assert.equal(typeof release,'function','the controlled run reaches its paused adapter');behavior='success';release();await playground.getByRole('button',{name:'Resume checking run',exact:true}).click();await playground.getByText('Verified result received.',{exact:true}).waitFor();
    const recovered=JSON.parse(await playground.getByLabel('API response JSON',{exact:true}).textContent());assert.equal(recovered.workflow_revision,2);assert.deepEqual(recovered.result,{value:'pinned-string'});assert.equal(consumerCount(),beforePending+1);assert.equal(await selector.isEnabled(),true);
    await page.unroute(explicitPattern);behavior='uncertain';await playground.getByLabel('quantity',{exact:true}).fill('uncertain');await submit.click();
    const acknowledge=playground.getByRole('checkbox',{name:/I inspected the website outcome of .* and authorize another execution/});await acknowledge.waitFor();assert.equal(await submit.isDisabled(),true);
    await selector.selectOption('1');await playground.getByText('Revision 1 loaded. Review its inputs before running.',{exact:true}).waitFor();
    assert.equal(await acknowledge.isVisible(),true);assert.equal(await acknowledge.isChecked(),false);assert.equal(await submit.isDisabled(),true,'changing revisions cannot clear uncertain-action consent');
    for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await selector.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await playground.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);await page.screenshot({path:join(dataDir,`revision-selection-${width}.png`)});}
    assert.equal(await playground.getByLabel('Scoped API key',{exact:true}).inputValue(),'');assert.equal((await page.content()).includes(first.key),false);assert.equal(await page.evaluate(key=>JSON.stringify({...localStorage,...sessionStorage}).includes(key),first.key),false);
    assert.equal(consumerCount(),4);assert.equal(executed.length,6);assert.deepEqual(errors,[]);console.log('Revision playground UI screenshots: '+dataDir);
  }catch(error){if(page){await page.screenshot({path:join(dataDir,'failure.png')});console.log('Revision playground UI failure screenshot: '+join(dataDir,'failure.png'));console.log((await page.locator('.api-playground').allTextContents()).join(' ').slice(0,2500));}throw error;}
  finally{release?.();await browser?.close();await state?.app.close();if(previousMasterKey===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMasterKey;}
});
