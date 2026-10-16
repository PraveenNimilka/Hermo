import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readLegacyChatDocument} from '../companion/browser/chat-messages.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';

const turn=(prompt,answer)=>`<div class="pair"><div class="submitted"><div><div>${prompt}</div></div></div><div class="reply"><div class="body"><div><p>${answer}</p><p>Second <strong>paragraph</strong>.</p><pre>const x = 1;</pre></div></div><div class="toolbar"><button aria-label="Copy">Copy</button><button aria-label="Good response">Like</button><button aria-label="Read aloud">Read</button></div></div></div>`;

test('deep turns, direct paragraph toolbars and user Copy controls return the submitted text independently',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();
  const deep=(value,depth)=>'<div>'.repeat(depth)+value+'</div>'.repeat(depth);
  const user=value=>'<section>'+deep('<div><span>'+value+'</span></div><button aria-label="Copy message">Copy</button><button aria-label="Edit message">Edit</button>',65)+'</section>';
  const reply=value=>'<section>'+deep('<p>'+value+'</p><p>Second <strong>paragraph</strong>.</p><div><button title="Copy message">Copy</button><button aria-label="Good response">Like</button><button aria-label="Read out loud">Read</button></div>',65)+'</section>';
  await page.setContent('<section aria-label="Conversation">'+deep(user('old')+reply('Old reply')+user('hi')+reply('Hey! 👋'),12)+'</section>');
  const result=await page.evaluate(readLegacyChatDocument,{});
  assert.equal(result[0].preview,'hi');assert.equal(result[1].preview,'Hey! 👋\n\nSecond paragraph.');
  assert.equal((await page.evaluate(readLegacyChatDocument,{role:'assistant'})).count,2);
  assert.doesNotMatch(result[1].preview,/Copy|Like|Old reply|Edit/);
  await page.setContent('<section aria-label="Conversation">'+user('actual submitted text')+reply('hi')+'</section>');
  assert.equal((await page.evaluate(readLegacyChatDocument,{role:'user'})).text,'actual submitted text');
 }finally{await browser.close();}
});
test('Conversation layout without role attributes returns full paired messages, excludes feedback and preserves the old action selectors',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();await page.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:`<nav>Sidebar answer</nav><section aria-label="Conversation">${turn('old prompt','Old answer')}${turn('hi','Hey <span>bro</span>!')}<div><p>Is this conversation helpful so far?</p><button aria-label="Like">Like</button></div><div contenteditable="true" aria-label="Ask ChatGPT"></div></section>`}));await page.goto('https://chatgpt.com/');
  const output=await page.evaluate(readLegacyChatDocument,{});assert.equal(output.length,2);assert.equal(output[0].preview,'hi');assert.match(output[1].preview,/Hey bro!/);assert.match(output[1].preview,/Second paragraph/);assert.match(output[1].preview,/const x = 1/);assert.doesNotMatch(output[1].preview,/Old answer|Like|Copy|helpful|Sidebar/);
  const chrome={tabs:{get:async()=>({url:page.url(),status:'complete',title:'Chat'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
  const run=command=>executeBrowserCommand({chrome,tabId:1,origin:'https://chatgpt.com',command,inspect:inspectDocument});
  const snapshot=await run({op:'snapshot'});assert.ok(snapshot.doc.elements.some(x=>x.label==='Latest assistant response'));
  const user=await run({op:'read',selector:'[data-message-author-role="user"],[data-turn="user"]',read_mode:'last',details:true});assert.equal(user.text,'hi');assert.equal(user.count,2);assert.equal(user.streaming,false);
  const reply=await run({op:'read',selector:':hermo-latest-assistant',read_mode:'last',details:true});assert.match(reply.text,/Hey bro!/);assert.equal(reply.count,2);
  assert.equal(await run({op:'read',selector:':hermo-latest-user',read_mode:'last'}),'hi');
  await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<button aria-label="Stop">Stop</button>'));
  assert.equal((await run({op:'read',selector:':hermo-latest-assistant',read_mode:'last',details:true})).streaming,true);
  await assert.rejects(executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'read',selector:':hermo-latest-assistant',read_mode:'last'},inspect:inspectDocument}),/ORIGIN_CHANGED/);
 }finally{await browser.close();}
});
test('legacy extraction fails closed without a paired prompt or unambiguous message toolbar',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();
  for(const html of ['<section aria-label="Conversation"><p>Sidebar text is not a reply</p><button aria-label="Copy">Copy</button></section>', '<section aria-label="Conversation"><div><p>Reply quotes the requested prompt: hi</p></div><div><button aria-label="Copy">Copy</button><button aria-label="Good response">Like</button></div></section>']){
   await page.setContent(html);assert.deepEqual(await page.evaluate(readLegacyChatDocument,{}),{hermo_error:'ACTION_UNAVAILABLE'});
  }
  await page.setContent('<section aria-label="Conversation">'+turn('different prompt','hi')+'</section>');
  assert.equal((await page.evaluate(readLegacyChatDocument,{role:'user'})).text,'different prompt','prompt is read independently, never inferred from reply content');
 }finally{await browser.close();}
});
