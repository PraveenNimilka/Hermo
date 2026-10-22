import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('managed browser controls save visibility, refresh busy state and require exact reset consent',{timeout:90000},async()=>{
  const previousMaster=process.env.HERMO_MASTER_KEY,previousBrowser=process.env.HERMO_BROWSER_PATH;
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  process.env.HERMO_BROWSER_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe';
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/managed-profile-ui',randomUUID());mkdirSync(directory,{recursive:true});
  // The built dashboard, owner authorization, encrypted store and actual managed
  // profile routes are exercised. The engine is controlled; no website is opened.
  let profileBusy=false,closed=0;
  const engine={isOpen:()=>true,isPairing:()=>false,isProfileBusy:()=>profileBusy,close:async()=>{closed++;},closeAll:async()=>{},closeStudios:async()=>{}};
  let state,browser,page,cookie='',csrf='';const errors=[];
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>engine});const {app,store,origin}=state;
    const call=async(path,body)=>{
      const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});
      if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
      assert.ok(response.statusCode<300,response.body);return response.json();
    };
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-managed-profile-ui-owner'})).csrf;
    const cid='conn_managed_profile_ui',wid='wf_managed_profile_ui',name='Managed browser fixture',at=new Date().toISOString(),url=origin+'/sandbox/managed-profile';
    const configuration={url,origins:[origin],access:'account',browser_mode:'isolated',identity:{kind:'public_origin',origin},checkpoint:{selector:'#account'},studioState:{url},storageState:{cookies:[{name:'synthetic_session',value:'fixture-only',domain:'127.0.0.1',path:'/'}],origins:[{origin,localStorage:[{name:'fixture',value:'synthetic'}],indexedDB:[]}]}};
    const definition={contract_version:'2',steps:[],inputs:{},outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval',timeout_ms:45000};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,name,url,'connected',store.seal(configuration),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Managed fixture action','managed.profile.fixture','published',definition.version,store.seal(definition),definition.version,at);
    store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_managed_profile_ui','Synthetic reset fixture',hash('synthetic-key-no-network'),'fixture',wid,new Date(Date.now()+86400000).toISOString(),null,at);
    const initial=await call(`/studio/connections/${cid}/managed-profile`);assert.equal(initial.session_saved,true);assert.equal(initial.identity_verified,true);assert.equal(initial.visibility,'headless');
    await app.listen({host:'127.0.0.1',port});
    browser=await chromium.launch({headless:true,executablePath:process.env.HERMO_BROWSER_PATH});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    const fit=async(panel,label)=>{
      for(const width of [1440,375]){
        await page.setViewportSize({width,height:1000});await panel.evaluate(element=>element.scrollIntoView({block:'start'}));
        const bounds=await panel.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,panel:element.scrollWidth<=element.clientWidth+1}));
        assert.deepEqual(bounds,{page:true,panel:true},`${label} fits ${width}px`);await page.screenshot({path:join(directory,`${label}-${width}.png`)});
      }
    };
    await page.goto(origin);await page.getByRole('button',{name:'Connections',exact:true}).click();
    const card=page.locator('.connection-card').filter({has:page.getByRole('heading',{name,exact:true})});
    await card.locator('summary').filter({hasText:'Managed browser'}).click();
    const panel=card.locator('.managed-profile'),visibility=panel.getByLabel('Execution visibility',{exact:true}),save=panel.getByRole('button',{name:'Save browser settings',exact:true}),refresh=panel.getByRole('button',{name:'Refresh status',exact:true});
    await panel.getByText('Encrypted session saved',{exact:true}).waitFor();assert.equal(await visibility.inputValue(),'headless');assert.equal(await save.isDisabled(),true);
    assert.match(await panel.textContent(),/GET and HEAD requests only/);assert.match(await panel.textContent(),/dedicated Chromium profile/);assert.match(await panel.textContent(),/encrypted between browser sessions/);assert.match(await panel.textContent(),/Temporary readable browser files/);
    await visibility.selectOption('visible');await save.click();await panel.getByText('Browser visibility saved. It applies to the next browser session.',{exact:true}).waitFor();
    assert.equal((await call(`/studio/connections/${cid}/managed-profile`)).visibility,'visible');assert.equal(await save.isDisabled(),true);assert.equal(closed,1);
    profileBusy=true;await refresh.click();await panel.getByText('In use · settings are locked',{exact:true}).waitFor();assert.equal(await visibility.isDisabled(),true);assert.equal(await refresh.isEnabled(),true,'A stale busy indication must not prevent refresh');
    profileBusy=false;await refresh.click();await panel.getByText('Ready',{exact:true}).waitFor();assert.equal(await visibility.isEnabled(),true);
    await fit(panel,'managed-browser-settings');
    const resetTrigger=panel.getByRole('button',{name:'Reset saved session…',exact:true});await resetTrigger.click();
    const dialog=page.getByRole('alertdialog',{name:'Reset this saved browser session?',exact:true}),reset=dialog.getByRole('button',{name:'Reset saved session',exact:true}),cancel=dialog.getByRole('button',{name:'Cancel',exact:true}),input=dialog.getByLabel(/^Type Reset/);
    await dialog.waitFor();await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Cancel');assert.equal(await cancel.evaluate(element=>element===document.activeElement),true);assert.equal(await reset.isDisabled(),true);
    await input.fill('Reset the wrong name');assert.equal(await reset.isDisabled(),true);assert.equal((await call(`/studio/connections/${cid}/managed-profile`)).session_saved,true);
    await fit(dialog,'managed-browser-reset-consent');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await resetTrigger.evaluate(element=>element===document.activeElement),true);
    await resetTrigger.click();assert.equal(await input.inputValue(),'');await input.fill(`Reset "${name}"`);assert.equal(await reset.isEnabled(),true);await reset.click();await dialog.waitFor({state:'hidden'});
    await panel.getByText('No session saved',{exact:true}).waitFor();await panel.getByText('Confirmation needed',{exact:true}).waitFor();
    const updated=await call(`/studio/connections/${cid}/managed-profile`);assert.equal(updated.session_saved,false);assert.equal(updated.identity_verified,false);assert.equal(updated.visibility,'visible');assert.equal(closed,2);
    const connection=store.db.prepare('SELECT * FROM connections WHERE id=?').get(cid),payload=store.unseal(connection.payload);assert.equal(connection.status,'auth_required');
    for(const field of ['storageState','studioState','checkpoint','identity'])assert.equal(payload[field],undefined,`${field} cleared`);
    const workflow=store.db.prepare('SELECT * FROM workflows WHERE id=?').get(wid);assert.equal(workflow.id,wid);assert.equal(workflow.status,'draft');assert.equal(workflow.test_version,null);assert.ok(store.db.prepare('SELECT revoked_at FROM api_keys WHERE id=?').get('key_managed_profile_ui').revoked_at);
    await fit(panel,'managed-browser-reset-result');assert.deepEqual(errors,[]);console.log('Managed profile UI screenshots: '+directory);
  }catch(error){if(page){await page.screenshot({path:join(directory,'failure.png')});console.log('Managed profile UI failure screenshot: '+join(directory,'failure.png'));}throw error;}
  finally{await browser?.close();await state?.app.close();if(previousMaster===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previousMaster;if(previousBrowser===undefined)delete process.env.HERMO_BROWSER_PATH;else process.env.HERMO_BROWSER_PATH=previousBrowser;}
});
