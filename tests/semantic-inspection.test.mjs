import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {inspectDocument} from '../companion/browser/inspect.mjs';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';

test('semantic inspection separates profile identity, chat turns and useful data without transcript duplicates',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();
    await page.setContent('<style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style><nav><p>Recent conversations</p><a href="/settings">Settings</a></nav><aside><button aria-label="Open profile menu"><span>Praveen Nimilka</span></button><div id="account"><span>owner@example.com</span></div></aside><main><p class="sr-only">Use the up and down arrow keys to move between messages.</p><section><h4 class="sr-only">You said:</h4><div><p>hi <strong>there</strong></p></div></section><section><h4 class="sr-only">Claude responded:</h4><div><p>Hello <strong>friend</strong>.</p><p>How can I help?</p><button>Copy</button><time>11 minutes ago</time></div></section><div aria-hidden="true">Claude responded: Hello friend. 11 minutes ago</div><div contenteditable="true" aria-label="Message"></div><button>Send</button></main>');
    const doc=await page.evaluate(inspectDocument,{connected:true});
    assert.equal(doc.elements.find(item=>item.preview==='owner@example.com').identity_eligible,true);
    assert.equal(doc.elements.find(item=>item.preview==='Praveen Nimilka').identity_eligible,true,'profile button content remains selectable as identity');
    const messages=doc.elements.filter(item=>item.read_mode==='last');
    assert.equal(messages.length,2);
    assert.equal(messages.find(item=>item.semantic_role==='user').preview,'hi there');
    assert.equal(messages.find(item=>item.semantic_role==='assistant').preview,'Hello friend.\n\nHow can I help?');
    assert.ok(messages.every(item=>item.identity_eligible===false));
    assert.equal(doc.elements.filter(item=>item.kind==='output').length,4,'only the name, email and the two complete turns are outputs');
    assert.equal(doc.elements.some(item=>/Recent conversations|11 minutes ago|arrow keys/.test(item.preview??'')),false);
    assert.equal(doc.elements.find(item=>item.label==='Settings').secondary,true);
    assert.equal(doc.elements.find(item=>item.label==='Copy').secondary,true);
    assert.equal(doc.elements.find(item=>item.label==='Send').secondary,false);
    assert.equal(doc.elements.find(item=>item.kind==='input').secondary,false);
    // Header prose containing role words cannot invent a conversation.
    await page.setContent('<h4>You said: hello earlier</h4><p>Ordinary article content</p>');
    assert.equal((await page.evaluate(inspectDocument,{connected:true})).elements.some(item=>item.read_mode==='last'),false);
    await page.setContent('<h4>Assistant:</h4><div><p>A section of an ordinary article.</p></div>');
    assert.equal((await page.evaluate(inspectDocument,{connected:true})).elements.some(item=>item.read_mode==='last'),false,'one speaker heading is insufficient to infer a chat');
  }finally{await browser.close();}
});

test('primary inputs and task controls precede a long sidebar while secondary controls remain addressable',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();await page.setContent('<aside id="app-shell-sidebar"><span>Example owner</span>'+Array.from({length:120},(_,i)=>'<a href="/item/'+i+'">History '+i+'</a>').join('')+'</aside><main><textarea aria-label="Question"></textarea><button aria-label="Send message">Send</button></main>');
    const doc=await page.evaluate(inspectDocument,{connected:true});
    assert.ok(doc.elements.some(item=>item.kind==='input'&&item.label==='Question'&&item.secondary===false));
    assert.ok(doc.elements.some(item=>item.label==='Send message'&&item.secondary===false));
    assert.ok(doc.elements.some(item=>item.label==='History 0'&&item.secondary===true));
    assert.equal(doc.elements.find(item=>item.preview==='Example owner').identity_eligible,true);
  }finally{await browser.close();}
});

test('heading-based latest reads rediscover fresh turns and preserve full replies, streaming state and exact tab scope',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();
    const turn=(prompt,response)=>'<section><h4>You said:</h4><div><p>'+prompt+'</p></div></section><section><h4>Claude responded:</h4><div><p>'+response+'</p><p>Second paragraph.</p><button>Copy</button></div></section>';
    await page.route('https://example.com/**',r=>r.fulfill({contentType:'text/html',body:'<main>'+turn('old','Old reply')+'</main>'}));await page.goto('https://example.com/');
    const chrome={tabs:{get:async()=>({url:page.url(),status:'complete',title:'Claude fixture'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
    const read=role=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'read',selector:':hermo-heading-'+role,read_mode:'last',details:true},inspect:inspectDocument});
    assert.equal((await read('assistant')).count,1);
    await page.locator('main').evaluate((el,html)=>el.insertAdjacentHTML('beforeend',html),turn('new prompt','New rich reply'));
    const reply=await read('assistant');assert.equal(reply.count,2);assert.equal(reply.text,'New rich reply\n\nSecond paragraph.');assert.equal(reply.streaming,false);
    assert.equal((await read('user')).text,'new prompt');
    await page.locator('main').evaluate(el=>el.insertAdjacentHTML('beforeend','<section><h4>You said:</h4><div><p>Give me a rich answer.</p></div></section><section><h4>Claude responded:</h4><div><h2>Answer title</h2><h3>Steps</h3><ol><li>First item</li><li>Second item</li></ol><pre><code>function ready() {\n  return true;\n}</code></pre><button>Copy</button></div></section>'));
    const rich=await read('assistant');assert.equal(rich.count,3);assert.equal(rich.text,'Answer title\n\nSteps\n\nFirst item\n\nSecond item\n\nfunction ready() {\n  return true;\n}');
    await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<button aria-label="Stop generating">Stop</button>'));
    assert.equal((await read('assistant')).streaming,true);
    await assert.rejects(executeBrowserCommand({chrome,tabId:1,origin:'https://wrong.example',command:{op:'read',selector:':hermo-heading-assistant',read_mode:'last'},inspect:inspectDocument}),/ORIGIN_CHANGED/);
    await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<input type="password">'));
    await assert.rejects(read('assistant'),/LOGIN_REQUIRED/);
  }finally{await browser.close();}
});

test('weather fields remain independently capturable while inline fragments and navigation are omitted',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();await page.setContent('<nav><p>Today</p><p>Hourly</p></nav><main><h1>Weather</h1><p id="place"><span>Colombo</span></p><output id="temperature">28 \u00b0C</output><p id="condition">Mostly <strong>cloudy</strong></p><dl><dt>Humidity</dt><dd>70%</dd></dl><div class="markdown"><p>First paragraph.</p><p>Second paragraph.</p></div></main>');
    const doc=await page.evaluate(inspectDocument,{connected:true}),fields=doc.elements.filter(item=>item.kind==='output');
    for(const value of ['Colombo','28 \u00b0C','Mostly cloudy','70%'])assert.equal(fields.filter(item=>item.preview===value).length,1,value+' appears once');
    assert.equal(fields.some(item=>item.preview==='Today'||item.preview==='Hourly'),false);
    assert.ok(fields.every(item=>item.identity_eligible===false),'weather text is never an account identity');
    assert.equal(fields.filter(item=>/First paragraph/.test(item.preview)).length,1,'rich output does not duplicate its paragraphs');
  }finally{await browser.close();}
});

test('named inline data fields sharing prose remain separately selectable',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();await page.setContent('<main><h3>Albert Einstein</h3><p>Born: <span class="author-born-date">March 14, 1879</span> <span class="author-born-location">in Ulm, Germany</span></p><p>Mostly <strong>cloudy</strong></p></main>');
    const fields=(await page.evaluate(inspectDocument,{connected:true})).elements.filter(item=>item.kind==='output');
    for(const value of ['Albert Einstein','March 14, 1879','in Ulm, Germany','Mostly cloudy'])assert.equal(fields.filter(item=>item.preview===value).length,1);
    assert.equal(fields.some(item=>item.preview.startsWith('Born:')),false,'a multiple-field wrapper does not duplicate its values');
    assert.ok(fields.every(item=>item.identity_eligible===false));
  }finally{await browser.close();}
});

test('attribute-based conversation results omit feedback controls and preserve rich output formatting',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage();await page.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<main><div data-message-author-role="user">A question</div><div data-message-author-role="assistant"><h2>Answer</h2><p>First paragraph.</p><p>Second paragraph.</p><pre><code>const ready = true;\n  ready;</code></pre><button>Copy response</button><button>Regenerate</button><time>2 minutes ago</time><span aria-hidden="true">Hidden transcript</span></div></main>'}));await page.goto('https://example.com/');
    const expected='Answer\n\nFirst paragraph.\n\nSecond paragraph.\n\nconst ready = true;\n  ready;',doc=await page.evaluate(inspectDocument,{connected:true});
    assert.equal(doc.elements.find(item=>item.semantic_role==='assistant').preview,expected);
    const chrome={tabs:{get:async()=>({url:page.url(),status:'complete'})},scripting:{executeScript:async({func,args=[]})=>[{result:await page.evaluate(func,args[0])}]}};
    const reply=await executeBrowserCommand({chrome,tabId:1,origin:'https://example.com',command:{op:'read',selector:'[data-message-author-role="assistant"]',read_mode:'last',details:true},inspect:inspectDocument});
    assert.equal(reply.text,expected);assert.equal(reply.count,1);
  }finally{await browser.close();}
});
