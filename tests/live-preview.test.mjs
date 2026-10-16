import test from 'node:test';
import assert from 'node:assert/strict';
import {createLivePreview,PREVIEW_LEASE_MS,PREVIEW_IDLE_MS,PREVIEW_FRAME_LIMIT} from '../companion/browser/live-preview.mjs';

function fixture(){
  let timestamp=100000,document=false,tab={id:7,url:'https://website.example/task',active:true,incognito:false},response;
  const calls=[],session={id:'connection-one',tabId:7,origin:'https://website.example',pathPrefix:'/',leaseExpiresAt:timestamp+3600000};
  const chrome={runtime:{getURL:path=>'chrome-extension://owned/'+path,getContexts:async()=>document?[{}]:[],sendMessage:async message=>{
    calls.push(message);if(message.op==='frame')return response??{ok:true,state:'live',image:'data:image/jpeg;base64,/9j/2Q==',captured_at:timestamp,width:900,height:600};return {ok:true};
  }},tabs:{get:async()=>tab},offscreen:{createDocument:async value=>{calls.push(value);document=true;},closeDocument:async()=>{calls.push('close');document=false;}},tabCapture:{getMediaStreamId:async value=>{calls.push(value);return 'one-use-owned-tab-stream';}}};
  return {preview:createLivePreview({chrome,now:()=>timestamp}),calls,session,chrome,setTime:value=>timestamp=value,setTab:value=>tab={...tab,...value},setResponse:value=>response=value,orphan:()=>{document=true;}};
}

test('visual preview is separate from connection recovery, explicit, tab-scoped, and bounded',async()=>{
  const f=fixture();f.orphan();await f.preview.reset();assert.ok(f.calls.includes('close'));
  assert.deepEqual(await f.preview.getFrame(f.session),{state:'disabled'});
  assert.equal(f.calls.some(value=>value?.targetTabId),false,'read requests do not grant visual access');
  f.setTab({active:false});await assert.rejects(f.preview.start(f.session),/Open the connected website tab/);
  f.setTab({active:true,url:'https://other.example/'});await assert.rejects(f.preview.start(f.session),/Open the connected website tab/);
  f.setTab({url:'https://website.example/task'});
  const start=await f.preview.start(f.session);assert.equal(start.state,'live');assert.equal(start.expires_at,100000+PREVIEW_LEASE_MS);
  assert.deepEqual(f.calls.find(value=>value?.targetTabId),{targetTabId:7});
  const begin=f.calls.find(value=>value?.op==='start');assert.equal(begin.idleMs,PREVIEW_IDLE_MS);assert.equal(begin.expiresAt,start.expires_at);assert.equal(begin.tabId,7);
  const frame=await f.preview.getFrame(f.session);assert.equal(frame.state,'live');assert.match(frame.image,/^[A-Za-z0-9+/=]+$/);
  assert.equal(frame.captured_at,100000);assert.ok(frame.image.length<PREVIEW_FRAME_LIMIT);
  await f.preview.stop({...f.session,id:'unrelated-session'});assert.equal((await f.preview.status(f.session)).state,'live','stopping another connection cannot stop this tab');
  f.setTab({url:'https://unrelated.example/'});assert.equal((await f.preview.getFrame(f.session)).state,'disabled');assert.equal((await f.preview.status(f.session)).state,'disabled');
});

test('expired or malformed frames fail closed and cannot become fresh screenshots',async()=>{
  for(const response of [
    {image:'data:image/png;base64,QQ=='},
    {image:'data:image/jpeg;base64,'+'A'.repeat(PREVIEW_FRAME_LIMIT)},
    {captured_at:1},{width:5000},{ok:false},
  ]){
    const f=fixture();await f.preview.start(f.session);f.setResponse({ok:true,state:'live',image:'data:image/jpeg;base64,/9j/2Q==',captured_at:100000,width:900,height:600,...response});
    assert.equal((await f.preview.getFrame(f.session)).state,'unavailable');assert.ok(f.calls.includes('close'));
    assert.equal((await f.preview.getFrame(f.session)).image,undefined);
  }
  const f=fixture();f.session.leaseExpiresAt=110000;assert.equal((await f.preview.start(f.session)).expires_at,110000);
  f.setTime(110001);assert.equal((await f.preview.getFrame(f.session)).state,'disabled');
  const next=fixture();await next.preview.start(next.session);next.setTime(100001+PREVIEW_LEASE_MS);assert.equal((await next.preview.getFrame(next.session)).state,'disabled');assert.ok(next.calls.includes('close'));
});

test('Stop during capture startup prevents a pending stream from becoming active',async()=>{
  const f=fixture();let release,started;
  const gate=new Promise(resolve=>release=resolve),pending=new Promise(resolve=>started=resolve);
  f.chrome.tabCapture.getMediaStreamId=async()=>{started();await gate;return 'stream-after-stop';};
  const activation=f.preview.start(f.session);await pending;await f.preview.stop(f.session);release();
  await assert.rejects(activation,/Preview stopped/);assert.equal((await f.preview.status(f.session)).state,'disabled');
  assert.equal(f.calls.some(value=>value?.op==='start'),false);
});

test('a delayed status or frame failure cannot stop a newer explicit capture',async()=>{
  for(const operation of ['status','frame']){
    const f=fixture();await f.preview.start(f.session);
    const original=f.chrome.runtime.sendMessage;let reject,entered;
    const pending=new Promise(resolve=>entered=resolve),gate=new Promise((_,fail)=>reject=fail);
    let intercept=true;
    f.chrome.runtime.sendMessage=async message=>{
      if(intercept&&message.op===operation){intercept=false;entered();return gate;}
      return original(message);
    };
    const previous=f.preview.getFrame(f.session);await pending;
    await f.preview.start(f.session);const closeCount=f.calls.filter(value=>value==='close').length;
    reject(Error('Previous capture ended'));assert.equal((await previous).state,'unavailable');
    assert.equal((await f.preview.getFrame(f.session)).state,'live');
    assert.equal(f.calls.filter(value=>value==='close').length,closeCount,'old request cannot tear down the replacement document');
    await f.preview.stop(f.session);
  }
});

test('a new start waits for the previous document teardown instead of losing its stream',async()=>{
  const f=fixture();await f.preview.start(f.session);
  let entered,release;const pending=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const original=f.chrome.offscreen.closeDocument;let intercept=true;
  f.chrome.offscreen.closeDocument=async()=>{if(intercept){intercept=false;entered();await gate;}return original();};
  const ending=f.preview.stop(f.session);await pending;
  const replacement=f.preview.start(f.session);release();await ending;await replacement;
  assert.equal((await f.preview.getFrame(f.session)).state,'live');
  assert.equal(f.calls.filter(value=>value?.op==='start').length,2);
  await f.preview.stop(f.session);
});

test('stopping the previous connection cannot cancel another tab being enabled',async()=>{
  const f=fixture();await f.preview.start(f.session);
  const next={...f.session,id:'connection-two',tabId:8};f.setTab({id:8});
  const replacement=f.preview.start(next);await Promise.resolve();
  const previousStop=f.preview.stop(f.session);
  await replacement;await previousStop;
  assert.equal((await f.preview.getFrame(next)).state,'live');
  assert.equal((await f.preview.getFrame(f.session)).state,'disabled');
  await f.preview.stop(next);
});

test('Stop preview clears a failed startup state without requiring a new capture',async()=>{
  const f=fixture();f.chrome.tabCapture.getMediaStreamId=async()=>{throw Error('Capture unavailable');};
  await assert.rejects(f.preview.start(f.session),/Capture unavailable/);
  assert.equal((await f.preview.status(f.session)).state,'unavailable');
  await f.preview.stop(f.session);
  assert.equal((await f.preview.status(f.session)).state,'disabled');
});
