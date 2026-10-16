import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readAccountIdentityDocument} from '../companion/browser/account-identity.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';

test('confirmed sidebar identity survives positional changes but rejects changed, hidden, duplicate and conversation-only names',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();await page.route('https://example.com/**',r=>r.fulfill({contentType:'text/html',body:'<aside id="app-shell-sidebar"><div><span>Example owner</span></div></aside><main aria-label="Conversation"><p>Example owner</p></main>'}));await page.goto('https://example.com/');
  const command={selector:'#app-shell-sidebar > div:nth-of-type(1) > span:nth-of-type(1)',identity_text:'Example owner',origin:'https://example.com',path_prefix:'/'};
  assert.equal(await page.evaluate(readAccountIdentityDocument,command),'Example owner');
  await page.locator('#app-shell-sidebar').evaluate(el=>el.innerHTML='<div>New sidebar item</div><div><button aria-label="Open profile menu"><div><span><span>Example owner</span></span></div></button></div>');
  assert.equal(await page.evaluate(readAccountIdentityDocument,command),'Example owner');
  for(const html of ['<span>Different owner</span>','<span hidden>Example owner</span>','<span>Example owner</span><span>Example owner</span>','<a href="/chat"><span>Example owner</span></a>','<div aria-label="Conversation"><p>Example owner</p></div>']){
   await page.locator('#app-shell-sidebar').evaluate((el,html)=>el.innerHTML=html,html);assert.deepEqual(await page.evaluate(readAccountIdentityDocument,command),{hermo_error:'ACTION_UNAVAILABLE'});
  }
  assert.deepEqual(await page.evaluate(readAccountIdentityDocument,{...command,origin:'https://wrong.example'}),{hermo_error:'ORIGIN_CHANGED'});
 }finally{await browser.close();}
});

test('account identity read waits for hydration and credential pages still fail closed',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();await page.route('https://example.com/**',r=>r.fulfill({contentType:'text/html',body:'<aside id="app-shell-sidebar"></aside><button>App</button>'}));await page.goto('https://example.com/');
  const chrome={tabs:{get:async()=>({url:page.url(),status:'complete'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
  const command={op:'read',selector:'#app-shell-sidebar > span:nth-of-type(1)',identity_text:'Example owner'};
  await page.evaluate(()=>setTimeout(()=>document.querySelector('#app-shell-sidebar').innerHTML='<div><span>Example owner</span></div>',350));
  assert.equal(await executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command,inspect:inspectDocument}),'Example owner');
  await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<input type="password">'));
  assert.deepEqual(await page.evaluate(readAccountIdentityDocument,{...command,origin:'https://example.com',path_prefix:'/'}),{hermo_error:'LOGIN_REQUIRED'});
  await assert.rejects(executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command,inspect:inspectDocument}),/LOGIN_REQUIRED/);
 }finally{await browser.close();}
});
