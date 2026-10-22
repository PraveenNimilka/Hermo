import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserEngine} from '../server/browser.mjs';
import {managedBrowserInstallation} from '../server/managed-profile.mjs';
import {resolve} from 'node:path';

function pendingBrowser(){
  let resolveLaunch,navigations=0,closes=0,browserCloses=0;
  const launchOptions=[];
  const contexts=[],events=[];
  const browser={isConnected:()=>true,close:async()=>{browserCloses++;},newContext:async options=>{
    events.push(['create',options.offline]);
    const handlers=new Map();let isClosed=false;
    const page={on:()=>{},url:()=> 'about:blank',isClosed:()=>isClosed,goto:async()=>{navigations++;},bringToFront:async()=>{}};
    const ctx={on:(name,listener)=>handlers.set(name,listener),route:async()=>{events.push(['http-guard']);},routeWebSocket:async()=>{events.push(['socket-guard']);},setOffline:async value=>{events.push(['offline',value]);},setDefaultTimeout:()=>{},setDefaultNavigationTimeout:()=>{},newPage:async()=>{events.push(['page']);handlers.get('page')?.(page);return page;},close:async()=>{if(!isClosed){isClosed=true;closes++;handlers.get('close')?.();}},pages:()=>isClosed?[]:[page],browser:()=>browser};
    contexts.push(ctx);return ctx;
  }};
  const launchBrowser=options=>{launchOptions.push(options);return new Promise(resolve=>resolveLaunch=resolve);};
  const proxy={url:'http://127.0.0.1:1',register:()=>({release:()=>{}})};
  return {proxy,launchBrowser,resolve:()=>resolveLaunch(browser),get navigations(){return navigations;},get closes(){return closes;},get browserCloses(){return browserCloses;},contexts,events,launchOptions};
}

test('managed contexts stay offline until HTTP and WebSocket guards are installed',async()=>{
  const fixture=pendingBrowser(),engine=await createBrowserEngine(fixture.proxy,'http://127.0.0.1:4415',fixture);
  try{
    const opening=engine.open('guarded',{url:'https://fixture.test/',origins:['https://fixture.test'],access:'public'});
    await new Promise(done=>setImmediate(done));fixture.resolve();await opening;
    assert.deepEqual(fixture.events,[['create',true],['http-guard'],['socket-guard'],['offline',false],['page']]);
  }finally{await engine.closeAll();}
});

test('a missing configured browser is actionable and never falls back to another executable',async()=>{
  const previous=process.env.HERMO_BROWSER_PATH;let launches=0;
  process.env.HERMO_BROWSER_PATH=resolve('work/nonexistent-managed-browser.exe');
  const engine=await createBrowserEngine({url:'http://127.0.0.1:1',register:()=>({release:()=>{}})},'http://127.0.0.1:4415',{launchBrowser:async()=>{launches++;throw Error('Must not launch');}});
  try{
    assert.equal(managedBrowserInstallation().available,false);assert.equal(managedBrowserInstallation().source,'configured');
    await assert.rejects(engine.open('missing',{url:'https://fixture.test/',origins:['https://fixture.test'],access:'public'}),{message:'BROWSER_INSTALLATION_REQUIRED'});
    assert.equal(launches,0);
  }finally{await engine.closeAll();if(previous===undefined)delete process.env.HERMO_BROWSER_PATH;else process.env.HERMO_BROWSER_PATH=previous;}
});

test('idle managed processes close and an active preview prevents idle shutdown',async()=>{
  const fixture=pendingBrowser(),engine=await createBrowserEngine(fixture.proxy,'http://127.0.0.1:4415',{...fixture,idleTimeoutMs:100});
  const opening=engine.open('idle',{url:'https://fixture.test/',origins:['https://fixture.test'],access:'public'});
  await new Promise(done=>setImmediate(done));fixture.resolve();await opening;
  await new Promise(done=>setTimeout(done,150));assert.equal(fixture.browserCloses,0,'an active preview owns its browser');
  await engine.close('idle');await new Promise(done=>setTimeout(done,150));assert.equal(fixture.browserCloses,1);
  await engine.closeAll();assert.equal(fixture.browserCloses,1,'closed idle browser is removed from the pool');
});

test('the local runtime adapter starts without launching an unused isolated browser',async()=>{
  let launches=0,releases=0,rejectLaunch;
  const proxy={url:'http://127.0.0.1:1',register:()=>({username:'fixture',password:'fixture',release:()=>releases++})};
  const engine=await createBrowserEngine(proxy,'http://127.0.0.1:4415',{launchBrowser:()=>{launches++;return new Promise((_,reject)=>rejectLaunch=reject);}});
  assert.equal(launches,0,'companion-only use must not require another Chrome process');
  const connection={url:'https://fixture.test/',origins:['https://fixture.test'],access:'public'};
  const a=engine.open('a',connection),b=engine.open('b',connection);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(launches,1,'simultaneous opens share one pending launch');
  rejectLaunch(Error('Synthetic missing browser'));const attempts=await Promise.allSettled([a,b]);
  assert.deepEqual(attempts.map(value=>value.status),['rejected','rejected']);assert.equal(releases,2,'failed launch must release both proxy grants');
  await engine.closeAll();await engine.closeAll();
  await assert.rejects(engine.open('after-close',connection),/BROWSER_CLOSED/);assert.equal(launches,1);
});

test('closing during a pending browser launch closes the eventual browser',async()=>{
  let resolveLaunch,closes=0;
  const proxy={url:'http://127.0.0.1:1',register:()=>({release:()=>{}})};
  const engine=await createBrowserEngine(proxy,'http://127.0.0.1:4415',{launchBrowser:()=>new Promise(resolve=>resolveLaunch=resolve)});
  const open=engine.open('a',{url:'https://fixture.test/',origins:['https://fixture.test'],access:'public'});
  const result=assert.rejects(open,/BROWSER_CLOSED/);await new Promise(resolve=>setImmediate(resolve));
  const close=engine.closeAll();resolveLaunch({close:async()=>{closes++;}});await close;await result;assert.equal(closes,1);
});

test('Stop and Lock invalidate pending studio opens before they can navigate or reappear',async()=>{
  for(const stop of ['close','closeStudios']){
    const fixture=pendingBrowser(),engine=await createBrowserEngine(fixture.proxy,'http://127.0.0.1:4415',fixture);
    const open=engine.open('a',{url:'https://fixture.test/',origins:['https://fixture.test'],access:'public'}),rejected=assert.rejects(open,/BROWSER_CLOSED/);
    await new Promise(resolve=>setImmediate(resolve));await engine[stop]('a');fixture.resolve();await rejected;
    assert.equal(fixture.navigations,0);assert.equal(fixture.closes,1);assert.equal(engine.isOpen('a'),false);await engine.closeAll();
  }
});

test('cancellation during lazy launch never navigates the isolated execution afterward',async()=>{
  const fixture=pendingBrowser(),engine=await createBrowserEngine(fixture.proxy,'http://127.0.0.1:4415',fixture),controller=new AbortController();
  const execution=engine.execute({url:'https://fixture.test/',origins:['https://fixture.test'],access:'public'}, {steps:[],outputs:[],verifiers:[]},{},()=>{},controller.signal),rejected=assert.rejects(execution,/TIMEOUT/);
  await new Promise(resolve=>setImmediate(resolve));controller.abort(Error('TIMEOUT'));await rejected;assert.equal(fixture.contexts.length,0,'the run finishes before the pending launch resolves');fixture.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fixture.navigations,0);assert.equal(fixture.closes,1);await engine.closeAll();
});

test('visible execution selects a headed browser while cancellation still prevents late navigation',async()=>{
  const fixture=pendingBrowser(),engine=await createBrowserEngine(fixture.proxy,'http://127.0.0.1:4415',fixture),controller=new AbortController();
  const running=engine.execute({id:'visible',url:'https://fixture.test/',origins:['https://fixture.test'],access:'public',managed_profile:{visibility:'visible'}},{steps:[],outputs:[],verifiers:[]},{},()=>{},controller.signal);
  const cancelled=assert.rejects(running,{message:'WORKFLOW_CANCELLED'});
  await new Promise(done=>setImmediate(done));assert.equal(fixture.launchOptions[0].headless,false);
  controller.abort(Error('WORKFLOW_CANCELLED'));await cancelled;fixture.resolve();await new Promise(done=>setImmediate(done));
  assert.equal(fixture.navigations,0);assert.equal(fixture.closes,1);await engine.closeAll();
});
