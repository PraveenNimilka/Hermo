import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';

test('real Chromium cookie API hides parent-domain sign-in with old permissions and exposes it with the fix',{timeout:60000},async()=>{
  const root=resolve('work/companion-chromium-tests',randomBytes(6).toString('hex'));
  const source=resolve('integrations/google-session-extension'),paths=[];
  const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
  // These are test-only extensions in a new synthetic profile. Static cookie
  // grants isolate Chrome's domain permission check without a user account or
  // automating the operator's permission prompt. Production keeps them optional.
  for(const mode of ['old','fixed']){
    const path=join(root,mode);await mkdir(path,{recursive:true});paths.push(path);
    const origins=manifest.optional_host_permissions.filter(origin=>mode==='fixed'||origin!=='https://google.com/*');
    await writeFile(join(path,'manifest.json'),JSON.stringify({...manifest,name:'Hermo synthetic '+mode,
      permissions:['cookies'],host_permissions:origins,optional_permissions:[],optional_host_permissions:[],
      background:{service_worker:'probe.mjs'}}));
    await writeFile(join(path,'probe.mjs'),'chrome.runtime.onInstalled.addListener(() => {});');
    for(const file of ['popup.html','popup.css','popup.mjs','transfer.mjs'])await copyFile(join(source,file),join(path,file));
  }
  const context=await chromium.launchPersistentContext(join(root,'profile'),{
    channel:'chromium',headless:true,executablePath:process.env.HERMO_TEST_CHROMIUM_PATH,
    args:['--disable-extensions-except='+paths.join(','),'--load-extension='+paths.join(','),'--host-resolver-rules=MAP * ~NOTFOUND']});
  try{
    await context.route(/^https?:/,route=>route.abort());
    await context.addCookies([
      {name:'__Secure-1PSID',value:'synthetic-parent-sign-in',domain:'.google.com',path:'/',secure:true,httpOnly:true,sameSite:'None'},
      {name:'ACCOUNT_PATH',value:'synthetic-path-cookie',domain:'accounts.google.com',path:'/signin',secure:true,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage(),found=new Map();
    for(let attempt=0;attempt<100&&found.size<2;attempt++){
      for(const worker of context.serviceWorkers()){
        const name=await worker.evaluate(()=>chrome.runtime.getManifest().name);
        found.set(name.split(' ').at(-1),new URL(worker.url()).host);
      }
      if(found.size<2)await new Promise(done=>setTimeout(done,100));
    }
    assert.equal(found.size,2,'both isolated test extensions loaded');
    await page.goto('chrome-extension://'+found.get('old')+'/popup.html');
    assert.equal(await page.evaluate(async()=>{
      const cookies=await chrome.cookies.getAll({url:'https://accounts.google.com/'});
      return cookies.some(cookie=>cookie.name==='__Secure-1PSID');
    }),false);
    await page.goto('chrome-extension://'+found.get('fixed')+'/popup.html');
    const cookies=await page.evaluate(async()=>{
      const {normalizeCookies}=await import('./transfer.mjs');
      return normalizeCookies([await chrome.cookies.getAll({domain:'google.com'})]).map(({name,path})=>({name,path}));
    });
    assert.ok(cookies.some(cookie=>cookie.name==='__Secure-1PSID'));
    assert.ok(cookies.some(cookie=>cookie.name==='ACCOUNT_PATH'&&cookie.path==='/signin'));
    assert.equal(await page.locator('.account-link').getAttribute('href'),'https://myaccount.google.com/');
    assert.match(await page.locator('.note').first().textContent(),/0\.1\.1/);
  }finally{await context.close();}
});
