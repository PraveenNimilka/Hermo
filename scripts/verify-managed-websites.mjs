// Opt-in live compatibility checks against public demonstration services. This
// never uses a personal account, API key, saved connection or the running DB.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createBrowserEngine} from '../server/browser.mjs';
import {createEgressProxy} from '../server/network.mjs';

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const evidence={tested_at:new Date().toISOString(),kind:'live-managed-compatibility',checks:[],limitations:['Public demonstration services only; no provider login, CAPTCHA bypass or personal account is exercised.']};
const proxy=await createEgressProxy('http://127.0.0.1:1');let engine;
try{
  engine=await createBrowserEngine(proxy,'http://127.0.0.1:1');
  const run=async(name,url,definition,check)=>{
    const website=new URL(url),connection={id:'conn_live_'+evidence.checks.length,url,origins:[website.origin],access:'public',identity:{kind:'public_origin',origin:website.origin}};
    const started=Date.now();
    try{const value=await engine.execute(connection,{timeout_ms:45000,inputs:{},verifiers:[],...definition},{});check(value.result);evidence.checks.push({name,url,status:'passed',duration_ms:Date.now()-started,checks:value.verification.checks});console.log('PASS '+name);}
    catch(error){evidence.checks.push({name,url,status:'failed',duration_ms:Date.now()-started,error:error.message,verification:error.verification});console.error('FAIL '+name+': '+error.message);}
  };
  await run('JavaScript-rendered quote collection','https://quotes.toscrape.com/js/',{
    effect:'retrieval',steps:[],
    outputs:[{name:'quotes',type:'array',selector:'.quote',items:{type:'object',fields:[{name:'text',type:'string',selector:'.text'},{name:'author',type:'string',selector:'.author'}]}}],
  },result=>{assert.equal(result.quotes.length,10);assert.ok(result.quotes.every(quote=>quote.text&&quote.author));});
  await run('Public HTML POST demonstration','https://httpbin.org/forms/post',{
    effect:'recorded_browser_actions',
    steps:[{op:'fill',selector:'input[name=custname]',value:'Hermo synthetic compatibility check'},{op:'click',selector:'button'}],
    outputs:[{name:'response',type:'string',selector:'body'}],
  },result=>{const body=JSON.parse(result.response);assert.equal(body.form.custname,'Hermo synthetic compatibility check');});
  await run('Public secure WebSocket echo','https://echo.websocket.org/.ws',{
    effect:'recorded_browser_actions',
    steps:[{op:'wait_element',selector:'#pause',state:'visible',timeout_ms:15000},{op:'click',selector:'#pause'},{op:'fill',selector:'#content',value:'Hermo synthetic socket check'},{op:'click',selector:'#send'}],
    outputs:[{name:'response',type:'string',selector:'#console .recv:last-child'}],
    verifiers:[{kind:'changed',output:'response'}],
  },result=>assert.equal(result.response,'Hermo synthetic socket check'));
}finally{
  await engine?.closeAll();await proxy.close();mkdirSync('validation/results',{recursive:true});
  const file='validation/results/managed-websites-'+stamp+'.json';writeFileSync(file,JSON.stringify(evidence,null,2));console.log('Evidence: '+file);
}
if(evidence.checks.some(check=>check.status!=='passed'))process.exitCode=1;
