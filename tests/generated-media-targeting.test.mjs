import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {inspectDocument} from '../companion/browser/inspect.mjs';
import {extractOutputDocument} from '../companion/browser/output-extraction.mjs';
import {observationChanged} from '../server/output-mappings.mjs';
import {mediaTargetPresets} from '../companion/browser/media-targets.mjs';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160"/></svg>';
async function fixture(t,body){
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});t.after(()=>browser.close());
  const page=await browser.newPage();await page.route('https://example.com/**',route=>route.fulfill({contentType:route.request().url().includes('.svg')?'image/svg+xml':'text/html',body:route.request().url().includes('.svg')?svg:body}));await page.goto('https://example.com/');return page;
}

test('latest generated image targeting survives temporary turn IDs and excludes later avatars',async t=>{
  const page=await fixture(t,'<main><article data-message-author-role="assistant" id="turn-old"><img id="asset-temporary-1" width="240" height="160" src="/old.svg" alt="Generated artwork"></article></main>');
  const item=(await page.evaluate(inspectDocument,{connected:true})).elements.find(item=>item.type==='image_url');
  assert.equal(item.label,'Latest image URL');assert.equal(item.read_mode,'last');assert.equal(item.selector,'[data-message-author-role="assistant"] img');
  const read=()=>page.evaluate(inspectDocument,{connected:true,selector:item.selector,read_attribute:'src',read_mode:item.read_mode,origin:'https://example.com'}),before=await read();
  assert.equal(before.text,'https://example.com/old.svg');assert.equal(observationChanged(before,before),false);
  await page.locator('main').evaluate(main=>main.insertAdjacentHTML('beforeend','<article data-message-author-role="assistant" id="turn-replaced"><img id="asset-temporary-2" width="240" height="160" src="/new.svg" alt="Generated artwork"><img class="avatar" width="48" height="48" src="/avatar.svg"><img width="16" height="16" src="/status.svg"></article>'));
  await page.waitForFunction(()=>[...document.images].every(image=>image.complete));
  const after=await read();assert.equal(after.text,'https://example.com/new.svg');assert.equal(after.streaming,false);assert.equal(observationChanged(after,before),true);
  const preset=mediaTargetPresets.find(item=>item.value==='image');assert.ok(Object.isFrozen(preset));
  assert.equal((await page.evaluate(inspectDocument,{connected:true,...preset,read_mode:'last'})).text,after.text,'the editor repair preset reads the same latest result');
  assert.equal((await page.evaluate(inspectDocument,{connected:true,selector:item.selector,read_mode:'last',read_attribute:'alt'})).text,'Generated artwork');
  const mapping={name:'image_url',type:'url',selector:item.selector,read_mode:'last',read_attribute:'src',required:false};
  assert.equal((await page.evaluate(extractOutputDocument,{origin:'https://example.com',mapping})).value,after.text);
  await page.locator('#turn-old').evaluate(el=>el.remove());assert.equal((await read()).text,after.text,'removing historical turns does not break the captured selector');
  assert.equal(observationChanged(await read(),after),false,'an unchanged latest image cannot become fresh by rereading');
});

test('latest media readiness waits for real image loading and identifies page-local image addresses',async t=>{
  const page=await fixture(t,'<main><div role="log"><img width="240" height="160" src="/old.svg"></div></main>');
  let release;const wait=new Promise(resolve=>{release=resolve;});await page.route('https://example.com/pending.svg',async route=>{await wait;await route.fulfill({contentType:'image/svg+xml',body:svg});});
  t.after(()=>release());
  const item=(await page.evaluate(inspectDocument,{connected:true})).elements.find(item=>item.type==='image_url'),mapping={type:'url',selector:item.selector,read_mode:'last',read_attribute:'src'};
  await page.locator('[role="log"]').evaluate(el=>el.insertAdjacentHTML('beforeend','<img id="pending" width="240" height="160" src="/pending.svg">'));
  const legacy=await page.evaluate(inspectDocument,{...mapping,connected:true});assert.equal(legacy.streaming,true);
  const structured=await page.evaluate(extractOutputDocument,{mapping});assert.equal(structured.streaming,true,'optional/nested extraction must not call an unloaded image complete');
  release();await page.waitForFunction(()=>document.querySelector('#pending').naturalWidth>0);assert.equal((await page.evaluate(extractOutputDocument,{mapping})).streaming,false);
  await page.locator('#pending').evaluate(el=>el.src=URL.createObjectURL(new Blob(['canvas replacement'],{type:'image/png'})));
  assert.match((await page.evaluate(inspectDocument,{...mapping,connected:true})).text,/^blob:https:\/\/example\.com\//);
  assert.match((await page.evaluate(extractOutputDocument,{mapping})).value,/^blob:https:\/\/example\.com\//);
});

test('catalog media stays individually selected without inferred latest semantics',async t=>{
  const page=await fixture(t,'<main><article><img id="product-one" width="240" height="160" src="/one.svg"></article><article><img id="product-two" width="240" height="160" src="/two.svg"></article></main>');
  const items=(await page.evaluate(inspectDocument,{connected:true})).elements.filter(item=>item.type==='image_url');
  assert.deepEqual(items.map(item=>item.selector),['#product-one','#product-two']);assert.ok(items.every(item=>item.read_mode===undefined&&item.label==='Image URL'));
});

test('repair presets resolve image, video and audio in explicitly marked result streams without provider URLs',async t=>{
  const page=await fixture(t,'<main></main>');
  for(const [scope,tag,kind]of [['data-turn="assistant"','img','image'],['data-testid="assistant-message"','video','video'],['role="log"','audio','audio'],['data-testid="generated-image-preview"','img','image']]){
    await page.locator('main').evaluate((main,{scope,tag})=>main.innerHTML=`<div ${scope}><${tag} controls src="/old.svg" style="display:block;width:240px;height:160px"></${tag}><${tag} controls src="/new.svg" style="display:block;width:240px;height:160px"></${tag}></div>`,{scope,tag});
    const preset=mediaTargetPresets.find(item=>item.value===kind),mapping={selector:preset.selector,read_mode:'last',read_attribute:preset.read_attribute};
    const doc=await page.evaluate(inspectDocument,{connected:true}),item=doc.elements.find(item=>item.type===kind+'_url');assert.ok(item,kind+' result should be detected: '+JSON.stringify(doc.elements));assert.ok(preset.selector.split(', ').includes(item.selector));assert.equal(item.read_mode,'last');
    assert.equal((await page.evaluate(inspectDocument,{...mapping,connected:true})).text,'https://example.com/new.svg');
    assert.equal((await page.evaluate(extractOutputDocument,{mapping})).value,'https://example.com/new.svg');
  }
});

test('image preview replacement reads the new URL independently of its unchanged description',async t=>{
  const page=await fixture(t,'<main><div data-testid="generated-image-preview"><img width="240" height="160" src="/old.svg" alt="Generated image"></div></main>');
  const preset=mediaTargetPresets.find(item=>item.value==='image');
  const read=()=>page.evaluate(inspectDocument,{connected:true,selector:preset.selector,read_mode:'last',read_attribute:'src'}),before=await read();
  await page.locator('main').evaluate(main=>main.innerHTML='<div data-testid="generated-image-preview"><img width="240" height="160" src="/new.svg" alt="Generated image"></div><img class="avatar" width="48" height="48" src="/avatar.svg">');
  await page.waitForFunction(()=>[...document.images].every(image=>image.complete));
  const after=await read();assert.equal(after.text,'https://example.com/new.svg');assert.equal(observationChanged(after,before),true);assert.equal(after.streaming,false);
  assert.equal((await page.evaluate(inspectDocument,{connected:true,selector:preset.selector,read_mode:'last',read_attribute:'alt'})).text,'Generated image');
  assert.equal(observationChanged(await read(),after),false,'a repeated read is not a new generation');
});
