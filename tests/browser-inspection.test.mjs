import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {inspectDocument} from '../companion/browser/inspect.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {browserProblem} from '../companion/browser/status.mjs';
import {operateDocument} from '../companion/browser/commands.mjs';
import {richChatFixture} from './rich-chat-fixture.mjs';

test('complex website DOM does not turn one deep element into a failed tab read',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();
    await page.setContent('<h1>Example account</h1><button id="safe">Refresh</button>'+'<div>'.repeat(40)+'<button>Deep action</button><span>Deep output</span>'+'</div>'.repeat(40));
    const doc=await page.evaluate(inspectDocument,null);
    assert.ok(doc.elements.some(item=>item.selector==='#safe'));
    assert.ok(doc.elements.some(item=>item.preview==='Example account'));
    assert.ok(doc.elements.some(item=>item.label==='Deep action'),'deep controls must be addressable, not silently omitted');
    assert.ok(doc.elements.some(item=>item.preview==='Deep output'),'deep output text must be addressable');
    assert.equal(doc.credentials,false);
  }finally{await browser.close();}
});

test('deep rich editor updates ProseMirror state and exposes full latest response text',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage(),html=await richChatFixture();await page.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://example.com/');
    let doc=await page.evaluate(inspectDocument,{connected:true});const editor=doc.elements.find(x=>x.kind==='input'&&x.type==='editor');assert.ok(editor);
    assert.equal(editor.label,'Ask Chat');
    assert.equal(await page.evaluate(operateDocument,{op:'operate',kind:'fill',selector:editor.selector,value:'alpha',path_prefix:'/'}),true);
    await page.waitForFunction(()=>window.fixtureModel==='alpha');
    assert.equal(await page.locator('.ProseMirror p').innerText(),'alpha','native editing preserves the rich editor structure');
    doc=await page.evaluate(inspectDocument,{connected:true});const send=doc.elements.find(x=>x.label==='Send message');assert.equal(send.disabled,false);
    assert.equal(await page.evaluate(operateDocument,{op:'operate',kind:'click',selector:send.selector,path_prefix:'/'}),true);
    await page.getByText('Answer for alpha',{exact:true}).waitFor();
    doc=await page.evaluate(inspectDocument,{connected:true});const reply=doc.elements.find(x=>x.label==='Latest assistant response');assert.ok(reply);assert.match(reply.preview,/Answer for alpha/);assert.match(reply.preview,/Ready to use/);
    const state=await page.evaluate(operateDocument,{op:'read',selector:reply.selector,read_mode:reply.read_mode,details:true});
    assert.equal(state.count,2);assert.equal(state.streaming,false);assert.match(state.text,/Answer for alpha/);assert.equal(state.text.includes('Older response'),false);
    assert.equal(await page.evaluate(operateDocument,{op:'operate',kind:'fill',selector:editor.selector,value:'first line\nsecond line',path_prefix:'/'}),true);
    await page.waitForFunction(()=>window.fixtureModel==='first line\nsecond line',{},{timeout:5000});
  }finally{await browser.close();}
});

test('page inspection errors and Chrome permission errors have distinct recovery messages',async()=>{
  const chrome={tabs:{get:async()=>({url:'https://example.com/',title:'Example'})},scripting:{executeScript:async()=>[{error:'DOM_DEPTH_LIMIT'}]}};
  await assert.rejects(executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'snapshot'},inspect:inspectDocument}),/PAGE_READ_FAILED/);
  chrome.scripting.executeScript=async()=>{throw Error('Cannot access contents of url. Extension manifest must request permission.');};
  await assert.rejects(executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'snapshot'},inspect:inspectDocument}),/PERMISSION_REVOKED/);
  assert.match(browserProblem('PAGE_READ_FAILED'),/inspect/);
  assert.match(browserProblem('PERMISSION_REVOKED'),/Chrome did not grant/);
});

test('modern conversation turns expose stable latest outputs and avoid temporary control IDs',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();await page.setContent('<article data-turn="user"><p>old prompt</p></article><article data-turn="assistant"><p>old answer</p></article><article data-turn="user"><p>new prompt</p></article><article data-turn="assistant"><p>new answer</p><p>second paragraph</p></article><button id="radix-_r_5i_" aria-label="Send">Send</button>');
    const doc=await page.evaluate(inspectDocument,{connected:true}),outputs=doc.elements.filter(x=>x.kind==='output');
    assert.equal(outputs.length,2,'individual paragraphs must not offer brittle conversation outputs');
    assert.equal(outputs.find(x=>x.label==='Latest submitted message').preview,'new prompt');
    const response=outputs.find(x=>x.label==='Latest assistant response');assert.match(response.preview,/new answer.*second paragraph/s);
    assert.equal(response.selector,'[data-turn="assistant"]');assert.equal(response.read_mode,'last');
    assert.equal(doc.elements.find(x=>x.label==='Send').selector,'[aria-label="Send"]');
    await page.locator('button').evaluate(el=>el.id='radix-_r_changed_');
    assert.equal(await page.evaluate(operateDocument,{op:'ready',kind:'click',selector:'[aria-label="Send"]'}),true);
  }finally{await browser.close();}
});

test('selected-tab actions wait for hydration and enabled Send without duplicate clicks',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();await page.route('https://example.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Account</h1><script>window.clicks=0;setTimeout(()=>{document.body.insertAdjacentHTML("beforeend",\'<textarea aria-label="Message"></textarea><button aria-label="Send" disabled>Send</button>\');document.querySelector("textarea").addEventListener("input",()=>setTimeout(()=>document.querySelector("button").disabled=false,300));document.querySelector("button").addEventListener("click",()=>{window.clicks++;document.querySelector("button").remove();});},400);</script>'}));await page.goto('https://example.com/');
    const chrome={tabs:{get:async()=>({url:page.url(),status:'complete'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
    const act=(kind,selector,value)=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'operate',kind,selector,...value===undefined?{}:{value}},inspect:inspectDocument});
    await act('fill','[aria-label="Message"]','hello');await act('click','[aria-label="Send"]');
    assert.equal(await page.evaluate(()=>window.clicks),1);
    assert.equal(await page.locator('textarea').inputValue(),'hello');
    await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<input type="password"><button aria-label="Forbidden">Submit</button>'));
    await assert.rejects(act('click','[aria-label="Forbidden"]'),/LOGIN_REQUIRED/);
  }finally{await browser.close();}
});

test('visual preview never returns a different active tab or a credential page',async()=>{
  const doc={elements:[],credentials:false,login:false,challenge:false,authRejected:false,denied:false,networkError:false};let captures=0,active=2;
  const chrome={tabs:{get:async()=>({id:1,url:'https://example.com/',title:'Example',windowId:1}),query:async()=>[{id:active}],captureVisibleTab:async()=>{captures++;return 'data:image/jpeg;base64,/9j/';}},scripting:{executeScript:async({func})=>[{result:func.name==='readLegacyChatDocument'?{hermo_error:'ACTION_UNAVAILABLE'}:{...doc}}]}};
  const capture=()=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'snapshot',visual:true},inspect:inspectDocument});
  assert.equal((await capture()).image,'');assert.equal(captures,0);
  active=1;assert.equal((await capture()).image,'');assert.equal(captures,0,'active-tab access alone does not authorize visual sharing');
  chrome.tabs.captureVisibleTab=async()=>{active=2;return 'data:image/jpeg;base64,/9j/';};assert.equal((await capture()).image,'');
  active=1;doc.credentials=true;const before=captures;assert.equal((await capture()).image,'');assert.equal(captures,before);
});
