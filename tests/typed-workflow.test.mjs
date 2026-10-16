import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';

test('recorded scalar contract is edited, verified, published and shared by REST, MCP and the consumer UI',{timeout:120000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4421,dataDir=resolve('work/typed-contract',randomBytes(6).toString('hex')),{app,origin,store}=await createApp({port,dataDir});
  const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  app.get('/sandbox/scalars',async(req,reply)=>{
    const query=req.query,submitted=Object.hasOwn(query,'quantity'),quantity=submitted?query.quantity:'7',flag=submitted?query.flag==='true':true,colour=query.colour??'blue',note=submitted?query.note??'':'stale browser text';
    return reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><title>Scalar contract fixture</title><h1>Product filters</h1><form method="get" action="/sandbox/scalars"><label>Quantity<input name="quantity" type="number" value="${escape(quantity)}"></label><label>Enabled<input name="flag" type="checkbox" value="true" ${flag?'checked':''}></label><label>Colour<select name="colour"><option ${colour==='red'?'selected':''}>red</option><option ${colour==='blue'?'selected':''}>blue</option></select></label><label>Note<input name="note" value="${escape(note)}"></label><button>Apply filters</button></form>${submitted?`<dl><dt>Quantity result</dt><dd id="quantity-result">${escape(quantity)}</dd><dt>Enabled result</dt><dd id="flag-result">${flag}</dd><dt>Note result</dt><dd id="note-result">${escape(note||'EMPTY')}</dd><dt>Colour result</dt><dd id="colour-result">${escape(colour)}</dd></dl>`:''}`);
  });
  await app.listen({port,host:'127.0.0.1'});let cookie='',csrf='',browser;
  const call=async(path,body,headers={})=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf},...headers},...body===undefined?{}:{body:JSON.stringify(body)}});const set=response.headers.get('set-cookie');if(set?.startsWith('hermo_owner_'))cookie=set.split(';')[0];return {status:response.status,value:await response.json()};};
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const finish=async id=>{for(let n=0;n<200;n++){const run=await ok('/studio/runs/'+id);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('Run did not finish');};
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-scalar-contract-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Scalar fixture',url:origin+'/sandbox/scalars',access:'public',browser_mode:'isolated',authorized:true})).connection;
    await ok(`/studio/connections/${connection.id}/open`,{});await ok(`/studio/connections/${connection.id}/confirm`,{public_source:true});
    const recording=await ok('/studio/recordings',{connection_id:connection.id,name:'Typed product filters',slug:'typed.filters'}),snapshot=()=>ok(`/studio/connections/${connection.id}/browser`);
    for(const[label,kind,value,parameter]of [['Quantity','fill','2','quantity'],['Enabled','check','true','flag'],['Colour','select','red','colour'],['Note','fill','recorded note','note']]){
      const item=(await snapshot()).elements.find(item=>item.label===label&&item.kind!== 'output');assert.ok(item,label);
      await ok(`/studio/connections/${connection.id}/control`,{element_id:item.id,kind,value,parameter,recording_id:recording.id});
    }
    await ok(`/studio/connections/${connection.id}/control`,{element_id:(await snapshot()).elements.find(item=>item.kind==='button'&&item.label==='Apply filters').id,kind:'click',recording_id:recording.id});
    for(const[name,text]of [['quantity_result','2'],['flag_result','true'],['note_result','recorded note'],['colour_result','red']]){
      const item=(await snapshot()).elements.find(item=>item.kind==='output'&&item.preview===text);assert.ok(item,name);
      await ok(`/studio/recordings/${recording.id}/output`,{name,element_id:item.id});
    }
    let workflow=(await ok(`/studio/recordings/${recording.id}/finish`,{verifiers:[{kind:'nonempty',output:'note_result'},{kind:'equals_input',output:'colour_result',input:'colour'}]})).workflow;
    const before=store.unseal(store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(workflow.id).payload);
    const update={expected_version:workflow.version,inputs:{quantity:{type:'number',required:false,default:0,minimum:0,maximum:10},flag:{type:'boolean',required:false,default:false},colour:{type:'string',enum:['red','blue']},note:{type:'string',required:false}},outputs:workflow.outputs.map(output=>({name:output.name,type:output.name==='quantity_result'?'number':output.name==='flag_result'?'boolean':'string'}))};
    assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,update,{'x-hermo-csrf':'wrong'})).status,403);
    assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,{...update,expected_version:'stale'})).value.error.code,'VERSION_CHANGED');
    assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,{...update,inputs:{...update.inputs,unrecorded:{type:'string'}}})).status,400);
    assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,{...update,outputs:[{...update.outputs[0],selector:'#elsewhere'},...update.outputs.slice(1)]})).status,400);
    assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,{...update,inputs:{...update.inputs,quantity:{...update.inputs.quantity,default:99}}})).value.error.code,'INVALID_WORKFLOW_CONTRACT');
    workflow=(await ok(`/studio/workflows/${workflow.id}/contract`,update)).workflow;
    const after=store.unseal(store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(workflow.id).payload);
    assert.deepEqual(after.steps,before.steps);assert.deepEqual(after.outputs.map(({type,required,...field})=>field),before.outputs);assert.notEqual(workflow.version,update.expected_version);assert.equal(workflow.tested,false);
    assert.equal((await call(`/studio/workflows/${workflow.id}/publish`,{})).value.error.code,'TEST_REQUIRED');
    for(const input of [{quantity:'0',colour:'red'},{quantity:11,colour:'red'},{flag:'false',colour:'red'},{colour:'green'},{colour:'red',extra:'x'},{quantity:null,colour:'red'}])assert.equal((await call(`/studio/workflows/${workflow.id}/test`,{input})).status,400,JSON.stringify(input));
    const receipt=await ok(`/studio/workflows/${workflow.id}/test`,{input:{colour:'red'}});
    assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,{...update,expected_version:workflow.version})).value.error.code,'BROWSER_BUSY');
    const verified=await finish(receipt.run_id);assert.equal(verified.status,'succeeded',JSON.stringify(verified));assert.deepEqual(verified.result,{quantity_result:0,flag_result:false,note_result:'EMPTY',colour_result:'red'});assert.deepEqual(verified.input,{quantity:0,flag:false,colour:'red'});

    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await context.addCookies([{name:'hermo_owner_'+port,value:cookie.split('=')[1],url:origin+'/studio',httpOnly:true,sameSite:'Strict'}]);
    await page.goto(origin+'/#actions');await page.getByRole('button',{name:'Test action',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByText('Edit input and output types',{exact:true}).click();
    assert.equal(await dialog.getByLabel('Type for quantity',{exact:true}).inputValue(),'number');assert.equal(await dialog.getByLabel('Default for flag',{exact:true}).inputValue(),'false');
    for(const width of [1440,768,375]){
      await page.setViewportSize({width,height:1000});await dialog.getByLabel('Minimum for quantity',{exact:true}).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      assert.equal(await dialog.locator('.contract-editor-grid,.contract-editor-field').evaluateAll(elements=>elements.some(element=>element.scrollWidth>element.clientWidth+1)),false);
      const layout=await dialog.locator('.contract-editor-field:first-child .field,.contract-editor-field:first-child .checkbox-row').evaluateAll(elements=>elements.map(element=>({label:element.innerText,bounds:element.getBoundingClientRect().toJSON(),visibility:getComputedStyle(element).visibility,display:getComputedStyle(element).display})));
      writeFileSync(resolve(dataDir,`layout-${width}.json`),JSON.stringify(layout,null,2));
      if(width>600){const min=await dialog.getByLabel('Minimum for quantity',{exact:true}).boundingBox(),max=await dialog.getByLabel('Maximum for quantity',{exact:true}).boundingBox();assert.ok(Math.abs(min.y-max.y)<1,'adjacent numeric bounds have aligned input baselines');}
      await page.screenshot({path:resolve(dataDir,`contract-${width}.png`)});
    }
    await dialog.getByRole('button',{name:'Save contract',exact:true}).click();await dialog.getByText('Contract saved. Run verification again before publishing.',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Publish API',exact:true}).isDisabled(),true);await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
    const tested=await finish((await ok(`/studio/workflows/${workflow.id}/test`,{input:{quantity:0,flag:false,colour:'red'}})).run_id);assert.equal(tested.status,'succeeded',JSON.stringify(tested));
    const published=await ok(`/studio/workflows/${workflow.id}/publish`,{}),auth={authorization:'Bearer '+published.key,'idempotency-key':'typed-idem'};
    assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,{...update,expected_version:published.workflow.version})).value.error.code,'DRAFT_REQUIRED');
    const spec=await ok(`/studio/workflows/${workflow.id}/openapi`),schema=spec.paths['/v1/actions/typed.filters/versions/1/runs'].post.requestBody.content['application/json'].schema.properties.input;
    assert.equal(schema.properties.quantity.type,'number');assert.equal(schema.properties.flag.default,false);assert.deepEqual(schema.required,['colour']);assert.equal(spec.paths['/v1/runs/{run_id}'].get.responses['200'].content['application/json'].schema.properties.result.properties.flag_result.type,'boolean');
    const rest=await ok('/v1/actions/typed.filters/versions/1/runs',{input:{colour:'blue'}},auth);assert.equal((await ok('/v1/actions/typed.filters/versions/1/runs',{input:{quantity:0,flag:false,colour:'blue'}},auth)).run_id,rest.run_id);assert.equal((await finish(rest.run_id)).result.flag_result,false);
    const mcpHeaders={...auth,accept:'application/json, text/event-stream'},list=await ok('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list',params:{}},mcpHeaders),tool=list.result.tools.find(tool=>tool.name==='action_typed_filters');assert.equal(tool.inputSchema.properties.input.properties.quantity.type,'number');assert.equal(tool.inputSchema.properties.input.properties.flag.default,false);assert.deepEqual(tool.inputSchema.properties.input.required,['colour']);
    const called=await ok('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'action_typed_filters',arguments:{input:{quantity:0,flag:false,colour:'red'},request_id:'typed-mcp'}}},mcpHeaders);assert.equal(called.result.isError,undefined,JSON.stringify(called));assert.equal((await finish(called.result.structuredContent.run_id)).result.quantity_result,0);
    const contract=await ok('/v1/action-contract',undefined,auth);assert.deepEqual(contract.inputs,['quantity','flag','colour','note']);assert.equal(contract.input_schema.properties.quantity.type,'number');
    const exported=await ok(`/studio/workflows/${workflow.id}/export`);assert.equal(exported.format,'hermo.workflow.v0.2');assert.equal(exported.contract_version,'2');assert.equal(exported.inputs.quantity.default,0);assert.equal(exported.inputs.flag.default,false);assert.equal(exported.outputs.find(output=>output.name==='flag_result').type,'boolean');assert.ok(Object.values(exported.inputs).every(field=>!Object.hasOwn(field,'example')));
    assert.deepEqual(tool.inputSchema.properties.input.properties.colour.enum,['red','blue']);assert.equal(tool.inputSchema.properties.input.properties.quantity.minimum,0);assert.equal(tool.inputSchema.properties.input.properties.quantity.maximum,10);
    await page.goto(origin+'/workflow-data.html?action=typed.filters');await page.getByLabel('Hermo API key').fill(published.key);await page.getByRole('button',{name:'Use this action'}).click();await page.getByText('Enter the requested inputs, then run your action.',{exact:true}).waitFor();await page.locator('[name="colour"]').selectOption('red');await page.getByRole('button',{name:'Run action',exact:true}).click();await page.getByText(/Verified results received/).waitFor();assert.equal(await page.locator('#results article').filter({has:page.getByText('quantity_result',{exact:true})}).locator('p').innerText(),'0');assert.equal(await page.locator('#results article').filter({has:page.getByText('flag_result',{exact:true})}).locator('p').innerText(),'false');assert.deepEqual(errors,[]);
    await ok(`/studio/workflows/${workflow.id}/pause`,{});assert.equal((await call(`/studio/workflows/${workflow.id}/contract`,{...update,expected_version:published.workflow.version})).value.error.code,'DRAFT_REQUIRED');
  }finally{await browser?.close();await app.close();}
});
