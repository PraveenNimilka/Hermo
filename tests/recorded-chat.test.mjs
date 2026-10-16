import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {recordedChatOutputs} from '../server/recorded-chat.mjs';
import {repairChatDefinition} from '../server/repair-chat.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {inspectDocument} from '../companion/browser/inspect.mjs';
import {recordedPaths} from './recorded-chat-layout.mjs';

// Exact paths retained in the operator's original recording. No account text,
// prompts or replies are copied into this fixture.
const draft=()=>({inputs:{prompt:{type:'string'}},steps:[{op:'fill',parameter:'prompt',selector:'[aria-label="Ask\\ ChatGPT"]'},{op:'click',selector:'[aria-label="Send"]'}],outputs:Object.entries(recordedPaths).map(([name,selector])=>({name,selector,frame_path:[]}))});

test('recorded structural contract survives repair and selects the full latest reply',()=>{
 const original=draft(),copy=structuredClone(original),fixed=repairChatDefinition(original,[{kind:'input',type:'editor',selector:original.steps[0].selector}],{url:'https://chatgpt.com/c/current'});
 assert.deepEqual(original,copy);assert.deepEqual(fixed.chat_recording,recordedPaths);
 assert.deepEqual(repairChatDefinition(fixed,[{kind:'input',type:'editor',selector:original.steps[0].selector}],{url:'https://chatgpt.com/c/current'}),fixed);
 assert.equal(fixed.steps.length,2);assert.equal(fixed.steps.some(x=>x.op==='navigate'),false);
 assert.ok(fixed.outputs.every(x=>x.read_mode==='last'&&x.selector.startsWith('[aria-label="Conversation"] > ')));
 assert.ok(!fixed.outputs[1].selector.endsWith('p:nth-of-type(1)'));
 for(const pair of [{...recordedPaths,prompt_echo:'#sidebar'}, {...recordedPaths,response:recordedPaths.prompt_echo}, {...recordedPaths,response:recordedPaths.response.replace('p:nth-of-type(1)','button:nth-of-type(1)')}])assert.equal(recordedChatOutputs({...original,chat_recording:pair}),undefined);
});

test('actual recorded depth works without role attributes or accessible toolbar labels, including repeated identical prompts',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html',body:'<nav>Unrelated sidebar</nav><section aria-label="Conversation"></section><div contenteditable="true" aria-label="Ask ChatGPT"></div>'}));await page.goto('https://chatgpt.com/c/current');
  // Construct only from the recorded paths, not the toolbar reader algorithm.
  const layout=paths=>{
   const common=paths.prompt_echo.split(' > ');const reply=paths.response.split(' > ');let split=0;while(common[split]===reply[split])split++;
   const follow=(root,parts)=>{let node=root;for(const part of parts){const [,tag,n]=part.match(/^(\w+):nth-of-type\((\d+)\)$/);while([...node.children].filter(x=>x.tagName.toLowerCase()===tag).length<Number(n))node.append(document.createElement(tag));node=[...node.children].filter(x=>x.tagName.toLowerCase()===tag)[Number(n)-1];}return node;};
   const root=document.querySelector('[aria-label="Conversation"]');const prefix=follow(root,common.slice(1,split-1));
   window.appendRecordedTurn=(prompt,answer)=>{
    const pair=document.createElement('div');prefix.append(pair);
    follow(pair,common.slice(split)).textContent=prompt;
    const p=follow(pair,reply.slice(split));p.textContent=answer;
    p.parentElement.insertAdjacentHTML('beforeend','<p>Second <strong>paragraph</strong>.</p><pre>const x = 1;</pre>');
    // Unlabelled icons cannot be used to discover this message pair.
    pair.insertAdjacentHTML('beforeend','<div><button><svg></svg></button><button><svg></svg></button></div>');
   };
   const flatParent=follow(prefix,common.slice(split-1,split));
   window.appendFlatTurn=(prompt,answer)=>{
    const user=document.createElement('div'),replyTurn=document.createElement('div');flatParent.append(user,replyTurn);
    follow(user,common.slice(split+1)).textContent=prompt;
    const p=follow(replyTurn,reply.slice(split+1));p.textContent=answer;p.parentElement.insertAdjacentHTML('beforeend','<p>Full second paragraph.</p>');
   };
   window.resetToFlat=()=>{prefix.replaceChildren(flatParent);flatParent.replaceChildren();};
  };
  await page.evaluate(layout,recordedPaths);
  const outputs=recordedChatOutputs(draft()).outputs;
  const chrome={tabs:{get:async()=>({url:page.url(),status:'complete'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
  const identities=new Map();
  const read=async field=>{
    const raw=await executeBrowserCommand({chrome,tabId:1,origin:'https://chatgpt.com',inspect:inspectDocument,command:{op:'read',...field,details:true}});
    const {identity,...value}=raw;assert.match(identity,/^[A-Za-z0-9-]+:\d+$/);
    const prior=identities.get(field.selector);
    if(prior&&prior.count!==value.count)assert.notEqual(identity,prior.identity,'a newly observed turn has a different DOM identity even for the same prompt');
    else if(prior)assert.equal(identity,prior.identity,'rereading the same turn retains its identity');
    identities.set(field.selector,{identity,count:value.count});return value;
  };
  await assert.rejects(read(outputs[0]),/ACTION_UNAVAILABLE/);
  for(let count=1;count<=3;count++){
   await page.evaluate(n=>window.appendRecordedTurn('same prompt','Fresh reply '+n),count);
   assert.deepEqual(await read(outputs[0]),{text:'same prompt',count,streaming:false});
   assert.deepEqual(await read(outputs[1]),{text:'Fresh reply '+count+'\n\nSecond paragraph.\n\nconst x = 1;',count,streaming:false});
  }
  assert.equal(page.url(),'https://chatgpt.com/c/current');
  await page.evaluate(()=>window.resetToFlat());
  for(let count=1;count<=3;count++){
   await page.evaluate(n=>window.appendFlatTurn('same flat prompt','Fresh flat reply '+n),count);
   assert.deepEqual(await read(outputs[0]),{text:'same flat prompt',count,streaming:false});
   assert.deepEqual(await read(outputs[1]),{text:'Fresh flat reply '+count+'\n\nFull second paragraph.',count,streaming:false});
  }
  await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<button aria-label="Stop generating">Stop</button>'));
  assert.equal((await read(outputs[1])).streaming,true);
  await page.locator('[aria-label="Conversation"]').evaluate(el=>el.remove());await assert.rejects(read(outputs[0]),/ACTION_UNAVAILABLE/);
 }finally{await browser.close();}
});
