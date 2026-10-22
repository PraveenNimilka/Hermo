import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';

// Real owner UI and HTTP persistence. Recording uses an owned sandbox website;
// this test does not claim to exercise completion evidence during execution.
test('owner saves advanced output constraints and typed rules in responsive real browser UI',{timeout:120000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const dataDir=resolve('work/output-editor-ui',randomUUID());mkdirSync(dataDir,{recursive:true});
  const {app,origin}=await createApp({port,dataDir});let browser,page,cookie='',csrf='';
  app.get('/sandbox/output-editor',async(_,reply)=>reply.type('text/html').send('<!doctype html><title>Output editor fixture</title><h1>Catalog query</h1><form method="get"><label>Query<input name="query" value="sample"></label><button>Search catalog</button></form><p id="amount">2</p><p id="ceiling">10</p><p id="dated">2024-02-29</p><p id="marker">request-1</p><article class="product"><h2 id="first-title" class="title">Notebook</h2><p class="price">2</p></article><p id="metadata">Catalog details</p>'));
  const call=async(path,body)=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:`127.0.0.1:${port}`,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf}},...body===undefined?{}:{payload:body}});if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];assert.ok(response.statusCode<300,response.body);return response.json();};
  try{
    await app.listen({port,host:'127.0.0.1'});csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/setup',{password:'synthetic-output-editor-password'})).csrf;
    const connection=(await call('/studio/connections',{name:'Output editor fixture',url:origin+'/sandbox/output-editor',access:'public',browser_mode:'isolated',authorized:true})).connection;
    await call(`/studio/connections/${connection.id}/open`,{});await call(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    const recording=await call('/studio/recordings',{connection_id:connection.id,name:'Advanced catalog contract',slug:'advanced.catalog',action_type:'custom'}),snapshot=()=>call(`/studio/connections/${connection.id}/browser`);
    await call(`/studio/connections/${connection.id}/control`,{element_id:(await snapshot()).elements.find(item=>item.kind==='input'&&item.label==='Query').id,kind:'fill',value:'sample',parameter:'query',recording_id:recording.id});
    await call(`/studio/connections/${connection.id}/control`,{element_id:(await snapshot()).elements.find(item=>item.kind==='button'&&item.label==='Search catalog').id,kind:'click',recording_id:recording.id});
    for(const [name,value]of [['amount_result','2'],['ceiling_result','10'],['dated_result','2024-02-29'],['marker_result','request-1'],['products','Notebook'],['metadata','Catalog details']]){
      const output=(await snapshot()).elements.find(item=>item.kind==='output'&&item.preview===value);assert.ok(output,name);
      await call(`/studio/recordings/${recording.id}/output`,{name,element_id:output.id});
    }
    const workflow=(await call(`/studio/recordings/${recording.id}/finish`,{verifiers:[{kind:'nonempty',output:'amount_result'}]})).workflow;
    const initial=await call(`/studio/workflows/${workflow.id}/editor`);
    const products={name:'products',type:'array',selector:'.product',minItems:1,maxItems:5,items:{type:'object',fields:[{name:'title',type:'string',selector:'.title'},{name:'price',type:'number',selector:'.price'}]}},metadata={name:'metadata',type:'object',selector:'#metadata',required:false,nullable:true,fields:[{name:'label',type:'string',selector:'.label',nullable:true},{name:'note',type:'string',selector:'.note',required:false}]};
    await call(`/studio/workflows/${workflow.id}/editor`,{expected_version:initial.version,steps:initial.definition.steps,inputs:initial.definition.inputs,outputs:initial.definition.outputs.map(field=>field.name==='products'?products:field.name==='metadata'?metadata:field),verifiers:initial.definition.verifiers,timeout_seconds:30});
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addCookies([{name:`hermo_owner_${port}`,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();
    let dialog=page.getByRole('dialog');await dialog.locator('.workflow-editor > summary').click();
    let editor=dialog.locator('.workflow-editor');await editor.getByRole('heading',{name:'Workflow editor',exact:true}).waitFor();
    const mappings=()=>editor.locator('.workflow-editor-inspector > .output-mappings').nth(0),rules=()=>editor.locator('.workflow-editor-inspector > .output-mappings').nth(1);
    const mapping=name=>mappings().locator(':scope > fieldset').filter({has:page.locator('legend').filter({hasText:new RegExp('^'+name+'$')})});
    const amount=mapping('amount_result');await amount.getByLabel('Value type',{exact:true}).selectOption('integer');await amount.getByText('Value constraints',{exact:true}).click();
    await amount.getByLabel('Minimum value',{exact:true}).fill('0');await amount.getByLabel('Maximum value',{exact:true}).fill('5');await amount.getByLabel('Allowed values (JSON array)').fill('[0,2,5]');
    const ceiling=mapping('ceiling_result');await ceiling.getByLabel('Value type',{exact:true}).selectOption('number');await ceiling.getByText('Value constraints',{exact:true}).click();await ceiling.getByLabel('Minimum value',{exact:true}).fill('5');await ceiling.getByLabel('Maximum value',{exact:true}).fill('20');
    const dated=mapping('dated_result');await dated.getByText('Value constraints',{exact:true}).click();await dated.getByLabel('Date or time format').selectOption('date');await dated.getByLabel('Minimum characters',{exact:true}).fill('10');await dated.getByLabel('Maximum characters',{exact:true}).fill('10');
    const marker=mapping('marker_result');await marker.getByText('Value constraints',{exact:true}).click();await marker.getByLabel('Fixed format pattern').fill('^request-\\d{1}$');
    await mapping('products').getByRole('checkbox',{name:'Require unique complete items',exact:true}).check();
    let checks=rules().locator(':scope > fieldset');await checks.nth(0).getByRole('combobox',{name:'Output',exact:true}).selectOption('amount_result');await checks.nth(0).getByRole('combobox',{name:'Condition',exact:true}).selectOption('compare');await checks.nth(0).getByRole('combobox',{name:'Comparison',exact:true}).selectOption('lte');await checks.nth(0).getByRole('combobox',{name:'Other output',exact:true}).selectOption('ceiling_result');
    await rules().getByRole('button',{name:'Add success check',exact:true}).click();await checks.nth(1).getByRole('combobox',{name:'Output',exact:true}).selectOption('products');await checks.nth(1).getByRole('combobox',{name:'Condition',exact:true}).selectOption('rows');await checks.nth(1).getByLabel('Field path within each row').fill('price');await checks.nth(1).getByRole('combobox',{name:'Comparison',exact:true}).selectOption('gte');await checks.nth(1).getByRole('combobox',{name:'Expected value type',exact:true}).selectOption('number');await checks.nth(1).getByLabel('Expected value',{exact:true}).fill('0');await checks.nth(1).getByRole('combobox',{name:'Matching rows',exact:true}).selectOption('all');
    await rules().getByRole('button',{name:'Add success check',exact:true}).click();await checks.nth(2).getByRole('combobox',{name:'Output',exact:true}).selectOption('amount_result');await checks.nth(2).getByRole('combobox',{name:'Condition',exact:true}).selectOption('completion');await checks.nth(2).getByLabel('Completion evidence output').selectOption('marker_result');
    await editor.getByRole('button',{name:'Save draft',exact:true}).click();await editor.getByText('Draft saved. Run verification before publishing this revision.',{exact:true}).waitFor();
    const saved=(await call(`/studio/workflows/${workflow.id}/editor`)).definition;
    assert.deepEqual(saved.outputs.find(field=>field.name==='amount_result'),{...initial.definition.outputs.find(field=>field.name==='amount_result'),type:'integer',required:true,minimum:0,maximum:5,enum:[0,2,5]});
    assert.equal(saved.outputs.find(field=>field.name==='dated_result').format,'date');assert.equal(saved.outputs.find(field=>field.name==='dated_result').minLength,10);assert.equal(saved.outputs.find(field=>field.name==='dated_result').maxLength,10);assert.equal(saved.outputs.find(field=>field.name==='ceiling_result').minimum,5);assert.equal(saved.outputs.find(field=>field.name==='ceiling_result').maximum,20);assert.equal(saved.outputs.find(field=>field.name==='marker_result').pattern,'^request-\\d{1}$');assert.equal(saved.outputs.find(field=>field.name==='products').uniqueItems,true);assert.equal(saved.verifiers[1].value,0);assert.equal(typeof saved.verifiers[1].value,'number');assert.equal(saved.verifiers[2].evidence,'marker_result');
    await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('.workflow-editor > summary').click();editor=dialog.locator('.workflow-editor');
    await mapping('amount_result').getByText('Value constraints',{exact:true}).click();assert.equal(await mapping('amount_result').getByLabel('Value type',{exact:true}).inputValue(),'integer');assert.equal(await mapping('amount_result').getByLabel('Allowed values (JSON array)').inputValue(),'[0,2,5]');
    assert.equal(await rules().getByLabel('Completion evidence output').inputValue(),'marker_result');assert.equal(await rules().getByRole('combobox',{name:'Expected value type',exact:true}).inputValue(),'number');
    for(const width of [1440,375]){
      await page.setViewportSize({width,height:1000});
      for(const [name,panel]of [['constraints',mapping('amount_result')],['rules',rules()]]){
        await panel.evaluate(element=>element.scrollIntoView({block:'start'}));
        const layout=await dialog.evaluate(element=>({page:document.documentElement.scrollWidth<=innerWidth+1,dialog:element.scrollWidth<=element.clientWidth+1,left:element.getBoundingClientRect().left>=-1,right:element.getBoundingClientRect().right<=innerWidth+1}));assert.deepEqual(layout,{page:true,dialog:true,left:true,right:true},`${name} fits ${width}px`);
        const unlabeled=await panel.locator('input,select,textarea,button').evaluateAll(elements=>elements.filter(element=>element.getBoundingClientRect().width&&element.getBoundingClientRect().height).filter(element=>!element.labels?.length&&!element.getAttribute('aria-label')&&!element.getAttribute('aria-labelledby')&&!(element.tagName==='BUTTON'&&element.textContent.trim())).map(element=>element.outerHTML));assert.deepEqual(unlabeled,[],`${name} controls are named`);
        await page.screenshot({path:join(dataDir,`${name}-${width}.png`)});
      }
    }
    await page.setViewportSize({width:1440,height:1000});await mapping('amount_result').getByLabel('Minimum value',{exact:true}).focus();assert.equal(await mapping('amount_result').getByLabel('Minimum value',{exact:true}).evaluate(element=>element===document.activeElement),true);await page.keyboard.press('Tab');
    await dialog.getByText('Edit input and output types',{exact:true}).click();const basic=dialog.locator('.workflow-contract-editor');
    assert.equal(await basic.getByLabel('Type for output amount_result',{exact:true}).count(),0);assert.equal(await basic.getByLabel('Type for output products',{exact:true}).count(),0);assert.equal(await basic.getByText(/Edit this output in/).count(),6);
    await basic.getByRole('checkbox',{name:'Trim outer whitespace from query',exact:true}).check();await basic.getByRole('button',{name:'Save contract',exact:true}).click();await basic.getByText('Contract saved. Run verification again before publishing.',{exact:true}).waitFor();
    const after=(await call(`/studio/workflows/${workflow.id}/editor`)).definition;assert.equal(after.inputs.query.normalization,'trim');assert.deepEqual(after.outputs,saved.outputs,'basic input editing preserves all advanced constraints and optional/nullable structures');assert.deepEqual(after.verifiers,saved.verifiers);assert.deepEqual(errors,[]);
    console.log('Output editor UI screenshots: '+dataDir);
  }catch(error){if(page){await page.screenshot({path:join(dataDir,'failure.png')});console.log('Output editor UI failure screenshot: '+join(dataDir,'failure.png'));console.log((await page.locator('[role=dialog]').allTextContents()).join(' ').slice(-4500));}throw error;}finally{await browser?.close();await app.close();}
});
