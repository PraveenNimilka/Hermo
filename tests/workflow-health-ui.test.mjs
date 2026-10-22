import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('workflow health dashboard and downloaded report match owner measurements at mobile and desktop sizes',{timeout:60000},async()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/health-ui',randomUUID());mkdirSync(directory,{recursive:true});
  let state,browser,page,cookie='',csrf='';const errors=[];
  try{
    state=await createApp({port,dataDir:directory,browserEngineFactory:async()=>({isOpen:()=>false,closeAll:async()=>{},closeStudios:async()=>{}})});const {app,store,origin}=state;
    const call=async(path,body)=>{const r=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];assert.ok(r.statusCode<300,r.body);return r.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-health-ui-owner'})).csrf;
    const at=new Date().toISOString(),cid='conn_health_ui',wid='wf_health_ui',url=origin+'/sandbox/health',definition={steps:[],inputs:{},outputs:[{name:'answer',selector:'#answer'}],verifiers:[{kind:'nonempty',output:'answer'}]};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,'Health UI',url,'connected',store.seal({access:'public',origins:[origin],identity:{kind:'public_origin',origin}}),at);
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,cid,'Health report fixture','health.report.fixture','draft',definition.version,store.seal(definition),null,at);
    for(const [id,status,error]of [['run_health_ui_uncertain','succeeded',null],['run_health_ui_failed','failed',{code:'ELEMENT_NOT_FOUND',message:'DO_NOT_EXPORT'}]])store.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(id,wid,'fixture',id,'hash',status,store.seal({input:{private:'DO_NOT_EXPORT'},result:{private:'DO_NOT_EXPORT'},error,workflow_version:definition.version,execution_ms:100,steps:[]}),at,at);
    await app.listen({host:'127.0.0.1',port});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'View workflow health',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Workflow health',exact:true});await dialog.getByText('Fewer than 20 completed runs are available.',{exact:false}).waitFor();assert.equal(await dialog.locator('.health-metrics').textContent().then(value=>value.includes('No completed runs')),false);
    const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download sanitized report',exact:true}).click();const file=await downloaded,path=join(directory,'report.json');await file.saveAs(path);const report=JSON.parse(readFileSync(path,'utf8'));assert.equal(report.counts.invocations,2);assert.equal(report.counts.verified_success,0);assert.equal(report.counts.uncertain,1);assert.equal(report.counts.failed,1);assert.equal(JSON.stringify(report).includes('DO_NOT_EXPORT'),false);
    await dialog.getByLabel('Measurement period',{exact:true}).selectOption('7');await dialog.getByRole('button',{name:'Download sanitized report',exact:true}).waitFor();
    for(const width of [1440,375]){await page.setViewportSize({width,height:1000});assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:join(directory,`health-${width}.png`)});}
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await state?.app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
