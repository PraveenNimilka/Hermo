import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('production management UI uses named confirmations, live docs, bounded history and clean onboarding',{timeout:60000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const directory=resolve('work/management-ui',randomBytes(6).toString('hex')),port=4401;
  const {app,origin,store}=await createApp({port,dataDir:directory});
  const {db,seal}=store;
  let browser,cookie='',csrf='';
  const call=async(path,body)=>{
    const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});
    if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];
    assert.ok(r.statusCode<300,`${path}: ${r.statusCode} ${r.body}`);return r.json();
  };
  try{
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-management-owner-password'})).csrf;
    const stamp=new Date().toISOString(),cid='conn_fixture';
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Saved weather','https://weather.example.test/','connected',seal({url:'https://weather.example.test/',origins:['https://weather.example.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://weather.example.test'}}),stamp);
    for(const [wid,name,status,date]of [['wf_live','Live weather','published','2026-01-01T00:00:00.000Z'],['wf_draft','Unused draft','draft',stamp]]){
      const definition={version:'fixture',inputs:{},outputs:[{name:'temperature',selector:'#temperature'}],steps:[],verifiers:[{kind:'number',output:'temperature'}],action_type:'read',effect:'retrieval'};
      db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,name,wid,status,'fixture',seal(definition),status==='published'?'fixture':null,date);
    }
    const keySecret='hm_live_'+randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_fixture','Weather client',hash(keySecret),'ABC123','wf_live','2099-01-01T00:00:00.000Z',null,stamp);
    for(let i=0;i<27;i++){
      const when=new Date(Date.now()-i*60000).toISOString();
      db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run_'+i,'wf_live','key_fixture','request_'+i,hash('[]'),i%2?'failed':'succeeded',seal({input:{},workflow_version:'fixture',result:i%2?undefined:{temperature:'28'},duration_ms:1000}),when,when);
    }
    const saved=(await call('/studio/browser-workspaces',{name:'Unused browser',kind:'current'})).browser;
    await app.listen({port,host:'127.0.0.1'});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1050}});
    await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(7000);const rows=async expected=>{for(let i=0;i<80;i++){if(await page.locator('tbody tr').count()===expected)return;await page.waitForTimeout(50);}assert.equal(await page.locator('tbody tr').count(),expected);};page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.getByRole('heading',{name:'Your integration workspace'}).waitFor();
    assert.equal(await page.locator('.hero').count(),0,'no repeated marketing hero after setup');
    assert.equal(await page.getByRole('button',{name:'Create action',exact:true}).count(),1);
    assert.equal(await page.getByText('Integration lab',{exact:true}).count(),0);
    assert.equal(await page.locator('.getting-started').count(),0,'completed onboarding is hidden');
    mkdirSync(directory,{recursive:true});await page.waitForTimeout(2600);await page.screenshot({path:join(directory,'overview.png'),fullPage:true});
    await page.getByRole('button',{name:'API docs',exact:true}).click();
    assert.equal(await page.getByLabel('Action',{exact:true}).inputValue(),'wf_live','published action is the default');
    assert.equal(await page.getByRole('button',{name:'Create key',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'Actions',exact:true}).click();
    await page.getByRole('button',{name:'Delete action Unused draft',exact:true}).click();
    const dialog=page.getByRole('alertdialog'),confirmation=dialog.getByLabel('Deletion confirmation'),confirm=dialog.getByRole('button',{name:'Confirm deletion',exact:true});
    assert.equal(await confirm.isDisabled(),true);await confirmation.fill('Delete "unused draft"');assert.equal(await confirm.isDisabled(),true);
    await confirmation.fill('Delete "Unused draft"');assert.equal(await confirm.isEnabled(),true);
    await page.waitForTimeout(300);await page.screenshot({path:join(directory,'delete-action.png'),fullPage:true});await confirm.click();await dialog.waitFor({state:'hidden'});
    assert.equal(db.prepare('SELECT id FROM workflows WHERE id=?').get('wf_draft'),undefined);assert.ok(db.prepare('SELECT id FROM workflows WHERE id=?').get('wf_live'));
    await page.getByRole('button',{name:'Runs',exact:true}).click();
    await rows(20);await page.getByRole('button',{name:'Next',exact:true}).click();await rows(7);
    await page.getByRole('button',{name:'Verified',exact:true}).click();await rows(14);
    await page.getByLabel('Search runs').fill('missing');await page.getByText('No runs match this filter.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Privacy',exact:true}).click();
    assert.equal(await page.locator('.legacy-settings').getAttribute('open'),null);
    await page.getByRole('button',{name:'Revoke',exact:true}).click();
    await page.getByLabel('Deletion confirmation').fill('Delete "Weather client"');await page.getByRole('button',{name:'Confirm revocation',exact:true}).click();await page.getByRole('alertdialog').waitFor({state:'hidden'});
    assert.ok(db.prepare('SELECT revoked_at FROM api_keys WHERE id=?').get('key_fixture').revoked_at);
    await page.getByRole('button',{name:'Delete key Weather client ending ABC123'}).click();
    await page.getByLabel('Deletion confirmation').fill('Delete "Weather client" ');assert.equal(await page.getByRole('button',{name:'Confirm deletion',exact:true}).isDisabled(),true);
    await page.getByLabel('Deletion confirmation').fill('Delete "Weather client"');await page.getByRole('button',{name:'Confirm deletion',exact:true}).click();await page.getByRole('alertdialog').waitFor({state:'hidden'});
    assert.equal(db.prepare('SELECT id FROM api_keys WHERE id=?').get('key_fixture'),undefined);assert.equal(db.prepare('SELECT count(*) n FROM runs').get().n,27,'history preserved after key deletion');
    await page.getByRole('button',{name:'Connections',exact:true}).click();
    await page.getByRole('button',{name:'Remove connection Saved weather'}).click();
    assert.equal(await page.getByRole('button',{name:'Confirm deletion',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(db.prepare('SELECT id FROM connections WHERE id=?').get(cid));
    await page.getByRole('button',{name:'Delete saved browser Unused browser'}).click();
    await page.getByLabel('Deletion confirmation').fill('Delete "Unused browser"');await page.getByRole('button',{name:'Delete saved browser',exact:true}).click();await page.getByRole('button',{name:'Delete saved browser Unused browser'}).waitFor({state:'hidden'});
    assert.equal(db.prepare('SELECT id FROM browser_workspaces WHERE id=?').get(saved.id),undefined);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(2600);await page.screenshot({path:join(directory,'connections-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile shell stays inside viewport');
    assert.deepEqual(errors,[],'no client runtime errors');
  }finally{await browser?.close();await app.close();}
});
