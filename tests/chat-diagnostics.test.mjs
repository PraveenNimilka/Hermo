import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {richChatFixture} from './rich-chat-fixture.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';

test('chat layout inspection reports selected raw/clean text without account, storage or form data and refuses credential pages',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const fixture=await richChatFixture({recordedLegacy:true}),page=await browser.newPage();await page.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html',body:fixture}));await page.goto('https://chatgpt.com/c/owned');
  await page.getByLabel('Ask Chat',{exact:true}).fill('Diagnostic test prompt');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.waitForTimeout(1700);
  const fields=JSON.parse(await readFile('companion/browser/diagnostic-fields.json','utf8'));
  await page.evaluate(selector=>{
   const user=document.querySelector(selector);user.insertAdjacentHTML('afterbegin','<span class="sr-only" style="position:absolute;clip:rect(0,0,0,0)">You said:</span>');
   document.querySelector('#account').textContent='SIDEBAR_PRIVATE_SENTINEL';document.cookie='sensitive=COOKIE_PRIVATE_SENTINEL';localStorage.setItem('secret','STORAGE_PRIVATE_SENTINEL');document.querySelector('[contenteditable]').textContent='UNSUBMITTED_PRIVATE_SENTINEL';
  },fields[0].selector);
  const chrome={tabs:{get:async()=>({url:page.url(),status:'complete'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
  const run=(origin='https://chatgpt.com')=>executeBrowserCommand({chrome,tabId:1,origin,command:{op:'diagnose_chat',fields},inspect:inspectDocument});
  const report=await run(),probe=report.probes.find(x=>x.name==='prompt_echo').last.at(-1);
  assert.match(probe.raw,/You said:/);assert.equal(probe.clean,'Diagnostic test prompt');assert.equal(report.conversationRoots,1);assert.ok(report.trees[0].nodes.some(x=>x.excluded));
  assert.doesNotMatch(JSON.stringify(report),/SIDEBAR_PRIVATE|COOKIE_PRIVATE|STORAGE_PRIVATE|UNSUBMITTED_PRIVATE/);
  assert.equal(await page.evaluate(()=>window.fixtureSendCount),1,'inspection never submits another message');assert.equal(page.url(),'https://chatgpt.com/chat/1');
  await assert.rejects(run('https://example.com'),/ORIGIN_CHANGED/);
  await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<input type="password" value="PASSWORD_PRIVATE_SENTINEL">'));await assert.rejects(run(),/LOGIN_REQUIRED/);
 }finally{await browser.close();}
});

test('production popup loads inspection on reopen without extension reload, pairing or sending',{timeout:30000},async()=>{
 const extensionDirectory=resolve('work/chat-diagnostic-extension',randomBytes(8).toString('hex'));await mkdir(extensionDirectory,{recursive:true});await cp(resolve('companion/browser'),extensionDirectory,{recursive:true});
 const html=await readFile(resolve(extensionDirectory,'popup.html'),'utf8'),script=await readFile(resolve(extensionDirectory,'popup.mjs'),'utf8');
 await writeFile(resolve(extensionDirectory,'popup.html'),html.replace(/<details>.*?<\/details>/s,''));await writeFile(resolve(extensionDirectory,'popup.mjs'),script.slice(script.indexOf("document.body.classList.add('popup');"),script.indexOf("document.querySelector('#inspect-chat')")));
 const context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
 try{
  const cdp=await context.browser().newBrowserCDPSession(),{id}=await cdp.send('Extensions.loadUnpacked',{path:extensionDirectory});
  const fixture=await richChatFixture({recordedLegacy:true});await context.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:fixture}));const page=await context.newPage();await page.goto('https://chatgpt.com/c/owned');
  await page.getByLabel('Ask Chat',{exact:true}).fill('Popup diagnostic prompt');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.waitForTimeout(1700);
  const targets=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos;await cdp.send('Extensions.triggerAction',{id,targetId:targets.find(x=>x.url===page.url()).targetId});await page.waitForTimeout(500);
  const oldPopup=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url.endsWith('/popup.html'));assert.ok(oldPopup);await cdp.send('Target.closeTarget',{targetId:oldPopup.targetId});
  await writeFile(resolve(extensionDirectory,'popup.html'),html);await writeFile(resolve(extensionDirectory,'popup.mjs'),script);
  await cdp.send('Extensions.triggerAction',{id,targetId:targets.find(x=>x.url===page.url()).targetId});await page.waitForTimeout(500);
  const popup=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url.endsWith('/popup.html'));assert.ok(popup);
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:popup.targetId,flatten:false});
  const evaluate=expression=>new Promise((resolve,reject)=>{
   const listener=event=>{if(event.sessionId!==sessionId)return;const result=JSON.parse(event.message);if(result.id!==7)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(result.error||result.result?.exceptionDetails)reject(Error(JSON.stringify(result)));else resolve(result.result.result.value);};
   const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Popup diagnostic timeout'));},10000);cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:7,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);
  });
  const result=await evaluate("(async()=>{document.querySelector('details').open=true;document.querySelector('#inspect-chat').click();for(let n=0;n<80;n++){await new Promise(r=>setTimeout(r,50));const box=document.querySelector('#diagnostic-report');if(box.value)return JSON.parse(box.value);}throw Error(document.querySelector('#diagnostic-status').textContent);})()");
  assert.equal(result.format,'hermo.chat-layout.v1');assert.equal(result.probes.find(x=>x.name==='prompt_echo').last.at(-1).raw,'Popup diagnostic prompt');assert.equal(await page.evaluate(()=>window.fixtureSendCount),1);
  await evaluate("Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.fixtureCopied=value;}}});document.querySelector('#copy-diagnostics').click();true");
  assert.equal(await evaluate("JSON.parse(window.fixtureCopied).format"),'hermo.chat-layout.v1');assert.equal((await cdp.send('Target.getTargets')).targetInfos.filter(x=>x.url.includes('/controller.html')).length,0,'inspection does not establish or reset a connection');
 }finally{await context.close();}
});
