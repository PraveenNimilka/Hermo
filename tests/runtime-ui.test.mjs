import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('runtime health and execution evidence remain readable, neutral and responsive',{timeout:45000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const dataDir=resolve('work/runtime-ui',randomBytes(6).toString('hex')),port=4416;
  mkdirSync(dataDir,{recursive:true});
  const state=await createApp({port,dataDir}),{app,store,origin}=state,{db,seal}=store;let browser;
  try{
    let cookie='',csrf='';
    const call=async(path,body)=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];assert.ok(r.statusCode<300,r.body);return r.json();};
    csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-runtime-inspector-password'})).csrf;
    const at=new Date().toISOString(),definition={version:'fixture',effect:'recorded_browser_actions',inputs:{search_query:{}},steps:[{op:'fill',parameter:'search_query',selector:'#search'},{op:'click',selector:'#submit'}],outputs:[{name:'price',selector:'#price'}],verifiers:[{kind:'nonempty',output:'price'}]};
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('website','Product catalog','https://fixture.test/','stopped',seal({url:'https://fixture.test/',origins:['https://fixture.test'],access:'public',browser_mode:'connected'}),at);
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('workflow','website','Product lookup','product.lookup','published','fixture',seal(definition),'fixture',at);
    for(const status of ['succeeded','failed','verifying']){
      const payload={input:{search_query:'test product'},workflow_version:'fixture',phase:status,outcome:status==='succeeded'?'verified':status==='failed'?'unknown':undefined,progress:100,started_at:at,queue_duration_ms:120,execution_ms:2400,duration_ms:2520,current_step:{number:2,total:2,operation:'click'},steps:[{number:1,operation:'fill',input_name:'search_query',status:'succeeded',duration_ms:240},{number:2,operation:'click',status:status==='failed'?'failed':'succeeded',duration_ms:310}],...status==='succeeded'?{result:{price:'149.99'},verification:{checks:['nonempty_outputs'],verified_at:at}}:status==='failed'?{error:{code:'EXECUTION_OUTCOME_UNKNOWN',cause_code:'TIMEOUT',outcome:'unknown',retry_safe:false,step:2,message:'A website submission may have occurred. Inspect the website before retrying. Hermo did not repeat it.'}}:{}};
      // Active UI fixture is inserted after startup recovery. It is never a claimed website execution.
      db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run_ui_'+status,'workflow','studio',status,hash(status),status,seal(payload),at,at);
    }
    await app.listen({port,host:'127.0.0.1'});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    async function usable(label){
      const state=await page.evaluate(()=>{
        const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
        const targets=Array.from(document.querySelectorAll('.runtime-health,.execution-details,.execution-details *')).filter(visible);
        return {overflow:document.documentElement.scrollWidth>innerWidth+1,colored:targets.flatMap(e=>['color','backgroundColor','borderTopColor'].filter(p=>{const n=getComputedStyle(e)[p].match(/[\d.]+/g)?.map(Number);return n&&n.length>=3&&Math.max(...n.slice(0,3))-Math.min(...n.slice(0,3))>1;})),clipped:targets.filter(e=>e.matches('strong,code,dt,dd,.execution-step-state')&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)};
      });assert.equal(state.overflow,false,label);assert.deepEqual(state.colored,[],label);assert.deepEqual(state.clipped,[],label);
    }
    await page.goto(origin);await page.getByRole('heading',{name:'Local runtime is running'}).waitFor();
    for(const width of [1440,768,375]){
      await page.setViewportSize({width,height:1000});await usable('health at '+width);
      await page.screenshot({path:join(dataDir,'overview-'+width+'.png'),fullPage:true});
      for(const status of ['succeeded','failed','verifying']){
        await page.getByRole('button',{name:'Inspect run run_ui_'+status,exact:true}).click();
        const dialog=page.getByRole('dialog');await dialog.waitFor();await usable(status+' at '+width);
        const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.y>=-1&&bounds.y+bounds.height<=1001,'dialog stays within the viewport');
        assert.equal(await dialog.getByRole('list',{name:'Step history'}).locator('li').count(),2);
        if(status==='failed'){await dialog.getByText('Inspect the website before retrying',{exact:true}).waitFor();await dialog.getByText('TIMEOUT',{exact:true}).waitFor();}
        if(status==='verifying')await dialog.getByRole('status').getByText('Verifying captured outputs',{exact:true}).waitFor();
        await page.screenshot({path:join(dataDir,'run-'+status+'-'+width+'.png')});
        await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
      }
    }
    // A failed overview poll must change the process indicator without replacing old data with false readiness.
    await page.route('**/studio/overview*',route=>route.abort());
    await page.getByRole('heading',{name:'Local runtime is unreachable'}).waitFor({timeout:10000});
    await usable('runtime unavailable');assert.deepEqual(errors,[]);
  }finally{await browser?.close();await app.close();}
});
