import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

test('project management and independent action assignment work at narrow and desktop widths',{timeout:60000},async()=>{
  const bundles=readdirSync('dist/assets').filter(x=>x.endsWith('.js')).map(x=>readFileSync(join('dist/assets',x),'utf8')).join('');assert.ok(bundles.includes('Recent execution health'),'Build dashboard before project UI test');
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const directory=resolve('work/project-organization-ui',randomUUID());mkdirSync(directory,{recursive:true});const {app,store,origin}=await createApp({port,dataDir:directory});let browser,cookie='',csrf='';
  const call=async(path,body)=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,'x-hermo-csrf':csrf},...body===undefined?{}:{payload:body}});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];assert.ok(r.statusCode<300,r.body);return r.json();};
  try{
    await app.listen({host:'127.0.0.1',port});csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-project-ui-owner'})).csrf;
    const project=(await call('/studio/projects',{name:'Product research',description:'A carefully organized local project with a long description that must wrap correctly in every viewport.'})).project;
    const c=(await call('/studio/connections',{name:'Project fixture',url:origin+'/sandbox/',authorized:true})).connection;
    const at=new Date().toISOString(),definition={inputs:{},steps:[],outputs:[{name:'answer',selector:'#answer',type:'string'}],verifiers:[{kind:'nonempty',output:'answer'}],effect:'retrieval'};definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_project_ui',c.id,'Organized action','project.ui.action','draft',definition.version,store.seal(definition),null,at);
    const original=store.db.prepare('SELECT * FROM workflows WHERE id=?').get('wf_project_ui');
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);await page.goto(origin);
    await page.getByRole('button',{name:'Manage local projects',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('searchbox',{name:'Search projects'}).fill('organized');await dialog.locator('.project-list-item').filter({hasText:'Product research'}).waitFor();assert.equal(await dialog.locator('.project-list-item').count(),1);
    for(const width of [1440,375]){await page.setViewportSize({width,height:1000});assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await dialog.locator('.project-list-item').first().evaluate(e=>e.getBoundingClientRect().height>=44),'project search results remain visible');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(directory,`projects-${width}.png`),fullPage:true});}
    await dialog.getByRole('button',{name:'Close projects',exact:true}).click();await page.getByRole('combobox',{name:'Current project',exact:true}).selectOption(project.id);await page.getByRole('button',{name:'Manage local projects',exact:true}).click();
    await dialog.getByRole('textbox',{name:'Description',exact:true}).fill('Updated private description');await dialog.getByRole('button',{name:'Save project',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.project-list-item[aria-pressed="true"]')?.textContent?.includes('Updated private description'));
    await dialog.getByRole('button',{name:'Archive project',exact:true}).click();await dialog.getByRole('button',{name:'Unarchive project',exact:true}).waitFor();await dialog.getByRole('combobox',{name:'Show projects',exact:true}).selectOption('archived');await dialog.locator('.project-list-item').filter({hasText:'Product research'}).waitFor();await dialog.getByRole('button',{name:'Unarchive project',exact:true}).click();await dialog.getByRole('button',{name:'Archive project',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Close projects',exact:true}).click();await page.getByRole('combobox',{name:'Current project',exact:true}).selectOption('project_personal');await page.getByRole('button',{name:'Actions',exact:true}).click();const card=page.locator('.action-card').filter({has:page.getByRole('heading',{name:'Organized action',exact:true})});await card.getByRole('combobox',{name:'Project',exact:true}).selectOption(project.id);await card.waitFor({state:'hidden'});await page.getByRole('combobox',{name:'Current project',exact:true}).selectOption(project.id);await card.getByRole('heading',{name:'Organized action',exact:true}).waitFor();
    assert.deepEqual(store.db.prepare('SELECT * FROM workflows WHERE id=?').get('wf_project_ui'),original,'project changes preserve the complete workflow row');assert.equal(store.db.prepare('SELECT project_id FROM workflow_projects WHERE workflow_id=?').get('wf_project_ui').project_id,project.id);assert.deepEqual(errors,[]);console.log('Project UI evidence: '+directory);
  }finally{await browser?.close();await app.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
