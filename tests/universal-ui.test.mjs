import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';

const screenNames=['Overview','Connections','Actions','Runs','API docs','Privacy'];
const modes=['chat','generate_media','read','search_extract','submit_form','custom'];

async function assertMonochrome(page,where){
  const colored=await page.evaluate(()=>Array.from(document.querySelectorAll('.app-shell *, .unlock *, body>main *')).filter(element=>{
    const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(element).visibility!=='hidden'&&!element.closest('.browser-preview');
  }).flatMap(element=>{const style=getComputedStyle(element);return ['color','backgroundColor','borderTopColor','outlineColor'].flatMap(property=>{const parts=style[property].match(/[\d.]+/g)?.map(Number);return parts&&parts.length>=3&&Math.max(...parts.slice(0,3))-Math.min(...parts.slice(0,3))>1?[{tag:element.tagName,class:element.className?.baseVal??element.className,property,value:style[property]}]:[];});}));
  assert.deepEqual(colored,[],`${where}: Hermo chrome uses neutral colors without recoloring website images`);
}

async function assertUsable(page,where){
  const issues=await page.evaluate(()=>{
    const visible=element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};
    const text=element=>(element?.textContent??'').replace(/\s+/g,' ').trim();
    const named=element=>{
      const referenced=(element.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>text(document.getElementById(id))).join(' ').trim();
      const label=Array.from(element.labels??[]).map(text).join(' ').trim();
      return element.getAttribute('aria-label')?.trim()||referenced||label||element.getAttribute('title')?.trim()||(element.matches('button,a')?text(element):'');
    };
    return Array.from(document.querySelectorAll('button,input:not([type=hidden]),select,textarea,a[href]')).filter(visible).filter(element=>!named(element)).map(element=>({tag:element.tagName,type:element.getAttribute('type'),class:element.className}));
  });
  assert.deepEqual(issues,[],`${where}: visible controls have accessible names`);
  const overflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.ok(overflow.document<=overflow.width+1&&overflow.body<=overflow.width+1,`${where}: page overflow ${JSON.stringify(overflow)}`);
  for(const locator of [page.locator('[role=dialog]:visible'),page.locator('[role=alertdialog]:visible')]){
    if(await locator.count()){
      const rect=await locator.boundingBox();
      assert.ok(rect&&rect.x>=-1&&rect.x+rect.width<=overflow.width+1,`${where}: dialog fits horizontally`);
    }
  }
}

test('universal production UI supports six task types, accessible layouts and real recording through API publication',{timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const directory=resolve('work/universal-ui',randomBytes(6).toString('hex')),port=4412;
  mkdirSync(directory,{recursive:true});
  const state=await createApp({port,dataDir:directory}),{app,origin,store}=state,{db,seal,unseal}=store;
  let browser,cookie='',csrf='',connection,createdWorkflow;
  const evidence={fixture:'Disposable Northstar sandbox and synthetic owner only',screenshots:[],checks:[]};
  const call=async(path,body)=>{
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];
    assert.ok(response.statusCode<300,`${path}: ${response.statusCode} ${response.body}`);
    return response.json();
  };
  try{
    csrf=(await call('/studio/session')).csrf;
    csrf=(await call('/studio/setup',{password:'synthetic-universal-interface-owner-password'})).csrf;
    await app.listen({port,host:'127.0.0.1'});
    connection=(await call('/studio/connections',{name:'Northstar orders',url:origin+'/sandbox/',authorized:true})).connection;
    await call(`/studio/connections/${connection.id}/open`,{});
    await call(`/studio/connections/${connection.id}/demo-login`,{});
    const snapshot=await call(`/studio/connections/${connection.id}/browser`);
    const marker=snapshot.elements.find(item=>item.kind==='output'&&item.preview?.includes('Alex Morgan'));
    assert.ok(marker,'Synthetic sandbox identity is detected');
    await call(`/studio/connections/${connection.id}/confirm`,{element_id:marker.id,expected_text:marker.preview});
    const stamp=new Date().toISOString(),definition={version:'seed-1',inputs:{},outputs:[{name:'status',selector:'[data-testid="order-status"]'}],steps:[],verifiers:[{kind:'nonempty',output:'status'}],action_type:'read',effect:'retrieval'};
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_seed',connection.id,'Saved status action','status.saved','published','seed-1',seal(definition),'seed-1',stamp);
    for(const [id,name,slug]of [['wf_long','A longer saved website task name that wraps naturally on smaller cards','website.task.with-a-long-clear-identifier'],['wf_short','Hermo Chat Live Test','chat.reply.layout']]){
      db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(id,connection.id,name,slug,'paused','seed-1',seal({...definition,action_type:'custom'}),null,stamp);
    }
    const secret='hm_live_'+randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_seed','Synthetic dashboard client',hash(secret),'UI1234','wf_seed','2099-01-01T00:00:00.000Z',null,stamp);
    for(let index=0;index<17;index++){
      const when=new Date(Date.now()-index*60000).toISOString(),succeeded=index<12;
      db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(`run_seed_${index}`,'wf_seed','key_seed',`seed_request_${index}`,hash('[]'),succeeded?'succeeded':'failed',seal({input:{},workflow_version:'seed-1',result:succeeded?{status:'Available'}:undefined,duration_ms:750}),when,when);
    }
    await call('/studio/browser-workspaces',{name:'Saved test browser',kind:'current'});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(),pageErrors=[];
    page.setDefaultTimeout(12000);page.on('pageerror',error=>pageErrors.push(error.message));
    const settle=async()=>{await page.locator('main h1').waitFor();await page.waitForTimeout(180);};
    const capture=async(name)=>{const relative=name+'.png';await page.screenshot({path:join(directory,relative),fullPage:true});evidence.screenshots.push(relative);};
    await page.goto(origin);await settle();

    await t.test('six dashboard screens reflow with named controls and truthful metrics',async()=>{
      assert.equal(await page.locator('.bridge-strip').count(),1,'Website task to API transformation is visible');
      await page.locator('.metric strong').first().waitFor();
      assert.deepEqual(await page.locator('.metric strong').allTextContents(),['1','1','12'],'Dashboard counts reflect seeded stored data');
      for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:375,height:812},{width:844,height:390}]){
        await page.setViewportSize(viewport);
        for(const name of screenNames){
          await page.getByRole('button',{name,exact:true}).click();await settle();
          await assertUsable(page,`${name} at ${viewport.width}x${viewport.height}`);
          await assertMonochrome(page,`${name} at ${viewport.width}`);
          if(name==='Privacy'){
            assert.equal(await page.getByText('Connect your ChatGPT plan',{exact:true}).count(),0);
            assert.equal(await page.getByText('Optional: provider-specific AI API connector',{exact:true}).count(),0);
          }
          await capture(`${name.toLowerCase().replaceAll(' ','-')}-${viewport.width}`);
        }
      }
      evidence.checks.push('All six main screens at desktop, tablet, phone and phone landscape; accessible names and horizontal bounds; removed provider connector; stored metrics');
    });

    await t.test('mixed-length action cards keep metadata separated and footers aligned',async()=>{
      await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Actions',exact:true}).click();await settle();
      const cards=page.locator('.action-card');assert.equal(await cards.count(),3);
      const geometry=await cards.evaluateAll(items=>items.map(card=>{const box=card.getBoundingClientRect(),footer=card.querySelector('.card-actions').getBoundingClientRect(),context=card.querySelector('.action-context'),label=context.querySelector('p').getBoundingClientRect(),badge=context.querySelector('.action-family').getBoundingClientRect();return {left:box.left,top:box.top,height:box.height,footerTop:footer.top,footerLeft:footer.left,contentLeft:card.querySelector('h3').getBoundingClientRect().left,gap:Math.abs(label.top-badge.top)<10?badge.left-label.right:badge.top-label.bottom};}));
      for(const item of geometry){assert.ok(item.gap>=7,'Connection label and task badge have a visible gap');assert.ok(Math.abs(item.footerLeft-item.contentLeft)<1,'Card content uses one shared left edge');}
      for(let index=0;index<geometry.length;index++)for(let other=index+1;other<geometry.length;other++)if(Math.abs(geometry[index].top-geometry[other].top)<1)assert.ok(Math.abs(geometry[index].footerTop-geometry[other].footerTop)<1,'Buttons align across a row with different title lengths');
      await capture('action-alignment-desktop');await page.setViewportSize({width:375,height:812});await assertUsable(page,'Mixed-length action cards on phone');await assertMonochrome(page,'Action cards on phone');await capture('action-alignment-phone');
      evidence.checks.push('Mixed title/identifier lengths; separate connection/category metadata; common card insets; same-row footer alignment; monochrome own UI across every screen');
    });

    await t.test('task picker communicates six universal choices and dialogs preserve keyboard focus',async()=>{
      await page.setViewportSize({width:1440,height:1000});
      await page.getByRole('button',{name:'Actions',exact:true}).click();await settle();
      const trigger=page.getByRole('button',{name:'Create action',exact:true});
      await trigger.focus();await trigger.click();
      const dialog=page.getByRole('dialog'),picker=dialog.getByLabel('What should this action do?',{exact:true});
      try{await picker.waitFor();}catch(error){await capture('task-setup-failure');writeFileSync(join(directory,'task-setup-accessibility.txt'),await dialog.innerText());throw error;}
      assert.deepEqual(await picker.locator('option').evaluateAll(options=>options.map(option=>option.value)),modes);
      const details=[];
      for(const mode of modes){
        await picker.selectOption(mode);
        const guidance=dialog.locator('#task-guidance');
        assert.equal(await picker.getAttribute('aria-describedby'),'task-guidance');
        const value=(await guidance.innerText()).trim();assert.ok(value.length>40,`${mode} has useful task guidance`);details.push(value);
        assert.equal(await picker.inputValue(),mode);
      }
      assert.equal(new Set(details).size,6,'Every task type has distinct guidance');
      await assertUsable(page,'Task setup desktop');await capture('task-setup-desktop');
      for(let index=0;index<10;index++){
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')),true,'Dialog keeps keyboard focus within its controls');
      }
      for(const viewport of [{width:375,height:812},{width:844,height:390}]){
        await page.setViewportSize(viewport);await assertUsable(page,`Task setup ${viewport.width}`);await capture(`task-setup-${viewport.width}`);
      }
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(element=>element===document.activeElement),true,'Closing the dialog restores trigger focus');
      const outline=await trigger.evaluate(element=>{const style=getComputedStyle(element);return {style:style.outlineStyle,width:parseFloat(style.outlineWidth),shadow:style.boxShadow};});
      assert.ok(outline.width>0&&outline.style!=='none'||outline.shadow!=='none','Keyboard focus has a visible indicator');
      evidence.checks.push('Six task choices and distinct help; focus trap, Escape and focus restoration; setup dialog phone and landscape');
    });

    await t.test('recording saves a selected run budget and reaches verified API publication',async()=>{
      if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
      await page.setViewportSize({width:1440,height:1000});
      await page.getByRole('button',{name:'Create action',exact:true}).click();
      let dialog=page.getByRole('dialog');
      await dialog.getByLabel('Connected app',{exact:true}).selectOption(connection.id);
      await dialog.getByLabel('What should this action do?',{exact:true}).selectOption('search_extract');
      await dialog.getByLabel('Action name',{exact:true}).fill('Look up a Northstar order');
      await dialog.getByLabel('API action ID',{exact:true}).fill('orders.ui.universal');
      await dialog.getByRole('button',{name:'Start demonstration',exact:true}).click();
      await dialog.getByRole('heading',{name:'Show Hermo how it works'}).waitFor();
      const orderForm=dialog.locator('.input-control').filter({has:page.getByLabel('Order ID',{exact:true})});
      await orderForm.getByLabel('Order ID',{exact:true}).fill('ORD-2042');
      await orderForm.getByRole('button',{name:'Fill field',exact:true}).click();
      await dialog.getByRole('button',{name:'Search orders',exact:true}).click();
      await dialog.getByRole('button',{name:'Outputs',exact:true}).click();
      await dialog.getByLabel('Find an output',{exact:true}).fill('Processing');
      await dialog.locator('.output-choice').filter({hasText:'Processing'}).first().click();
      await dialog.getByLabel('Output name',{exact:true}).fill('status');
      await dialog.getByRole('button',{name:'Add output',exact:true}).click();
      await dialog.getByRole('button',{name:'Define verification',exact:true}).click();
      await dialog.getByRole('heading',{name:'Define a verified result'}).waitFor();
      const budget=dialog.getByLabel('Maximum run time',{exact:true});
      assert.deepEqual(await budget.locator('option').evaluateAll(options=>options.map(option=>Number(option.value))),[45,60,180,300]);
      await budget.selectOption('180');
      await dialog.getByLabel('status',{exact:true}).selectOption('contains');
      await dialog.getByLabel('Expected text in status',{exact:true}).fill('Processing');
      await dialog.getByRole('checkbox').last().check();
      await assertUsable(page,'Verification rules desktop');await capture('verification-desktop');
      await page.setViewportSize({width:375,height:812});await assertUsable(page,'Verification rules phone');await capture('verification-phone');
      await page.setViewportSize({width:1440,height:1000});
      await dialog.getByRole('button',{name:'Save & test action',exact:true}).click();
      await page.getByRole('heading',{name:'Verify your action'}).waitFor();
      const saved=db.prepare('SELECT * FROM workflows WHERE slug=?').get('orders.ui.universal');assert.ok(saved,'Recorded draft saved');
      createdWorkflow=saved.id;
      const savedDefinition=unseal(saved.payload);
      assert.equal(savedDefinition.action_type,'search_extract');
      assert.equal(savedDefinition.timeout_ms,180000,'Selected run budget persists to the workflow');
      assert.equal(savedDefinition.inputs.order_id.example,'ORD-2042');
      await page.getByRole('button',{name:'Run verification',exact:true}).click();
      const publish=page.getByRole('button',{name:'Publish API',exact:true});
      await publish.waitFor();
      for(let attempt=0;attempt<100&&await publish.isDisabled();attempt++)await page.waitForTimeout(150);
      assert.equal(await publish.isEnabled(),true,'Actual browser replay and captured-result checks pass');
      const run=db.prepare('SELECT * FROM runs WHERE workflow_id=? ORDER BY created_at DESC LIMIT 1').get(createdWorkflow);
      assert.equal(run.status,'succeeded');assert.equal(unseal(run.payload).result.status,'Processing');
      await capture('verified-action');
      await publish.click();await page.getByRole('heading',{name:'Your action is ready.'}).waitFor();
      assert.equal(db.prepare('SELECT status FROM workflows WHERE id=?').get(createdWorkflow).status,'published');
      assert.ok(db.prepare('SELECT id FROM api_keys WHERE workflow_id=?').get(createdWorkflow),'Publishing creates a real scoped key');
      await page.getByRole('button',{name:'Done',exact:true}).click();
      evidence.checks.push('Actual synthetic sandbox input/search/output recording; 180-second budget persisted; browser replay verified; publication creates scoped key');
    });

    await t.test('destructive confirmation is an accessible alert dialog and cancel preserves data',async()=>{
      if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Actions',exact:true}).click();await settle();
      const trigger=page.getByRole('button',{name:'Delete action Saved status action',exact:true});
      await trigger.focus();await trigger.click();
      const dialog=page.getByRole('alertdialog');await dialog.waitFor();
      await assertUsable(page,'Destructive confirmation');await capture('delete-alertdialog');
      assert.equal(await dialog.getByRole('button',{name:'Confirm deletion',exact:true}).isDisabled(),true);
      await dialog.getByLabel('Deletion confirmation',{exact:true}).fill('Delete "Saved status action"');
      assert.equal(await dialog.getByRole('button',{name:'Confirm deletion',exact:true}).isEnabled(),true);
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});
      assert.ok(db.prepare('SELECT id FROM workflows WHERE id=?').get('wf_seed'));
      assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
      evidence.checks.push('Named typed alert dialog; cancellation preserves action; focus returns to trigger');
    });
    await t.test('workspace unlock and consumer setup states keep the same monochrome layout',async()=>{
      await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Lock workspace',exact:true}).click();await page.getByRole('heading',{name:'Welcome back.'}).waitFor();
      for(const viewport of [{width:1440,height:1000},{width:375,height:812}]){await page.setViewportSize(viewport);await assertUsable(page,'Workspace unlock');await assertMonochrome(page,'Workspace unlock');await capture('workspace-unlock-'+viewport.width);}
      for(const [name,url]of [['consumer-data','/workflow-data.html'],['consumer-chat','/workflow-chat.html']]){
        await page.goto(origin+url);for(const viewport of [{width:1440,height:1000},{width:375,height:812}]){await page.setViewportSize(viewport);await assertUsable(page,name);await assertMonochrome(page,name);await capture(name+'-'+viewport.width);}
      }
      evidence.checks.push('Workspace unlock and both consumer setup screens at desktop and phone; own UI monochrome and no overflow');
    });
    assert.deepEqual(pageErrors,[],'No client runtime errors');
    evidence.checks.push('Reduced-motion browser preference throughout; no client runtime errors');
  }finally{
    writeFileSync(join(directory,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
    await browser?.close();await app.close();
  }
});
