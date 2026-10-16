import test from 'node:test';
import assert from 'node:assert/strict';
import {PREVIEW_LEASE_MS,PREVIEW_IDLE_MS,PREVIEW_FRAME_FRESH_MS} from '../companion/browser/live-preview.mjs';

test('offscreen capture accepts only the worker, never audio, forgets pixels, and autonomously expires',async()=>{
  const names=['chrome','navigator','document','setInterval','clearInterval','addEventListener'];
  const descriptors=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));const originalNow=Date.now;
  let time=100000,listener,tick,tracksStopped=0,mediaRequests=0,draws=0,counterOnly=false;const canvases=[],videos=[],tracks=[];
  const extensionId='a'.repeat(32),url=path=>'chrome-extension://'+extensionId+'/'+path;
  const background={id:extensionId,url:url('background.mjs')};
  const globals={
    chrome:{runtime:{id:extensionId,getURL:url,onMessage:{addListener:value=>listener=value}}},
    navigator:{mediaDevices:{getUserMedia:async options=>{mediaRequests++;assert.equal(options.audio,false);assert.equal(options.video.mandatory.chromeMediaSource,'tab');assert.equal(options.video.mandatory.chromeMediaSourceId,'authorized-stream');const track={readyState:'live',muted:false,stop:()=>tracksStopped++,addEventListener:(event,callback)=>{track[event]=callback;}};tracks.push(track);return {getTracks:()=>[track],getVideoTracks:()=>[track]};}}},
    document:{createElement:kind=>{
      if(kind==='video'){
        let callback,frames=0;const video={readyState:4,videoWidth:1000,videoHeight:700,paused:true,requestVideoFrameCallback:counterOnly?undefined:value=>{callback=value;return frames;},cancelVideoFrameCallback:()=>{callback=undefined;},getVideoPlaybackQuality:()=>({totalVideoFrames:frames}),decode:()=>++frames,deliver:()=>{const next=callback;callback=undefined;++frames;next?.(0,{presentedFrames:frames});},play:async()=>{video.paused=false;video.deliver();},pause:()=>{video.paused=true;}};videos.push(video);return video;
      }
      assert.equal(kind,'canvas');const canvas={width:0,height:0,getContext:()=>({drawImage:()=>draws++}),toDataURL:()=>'data:image/jpeg;base64,/9j/2Q=='};canvases.push(canvas);return canvas;
    }},setInterval:callback=>{tick=callback;return 123;},clearInterval:()=>{},addEventListener:()=>{},
  };
  for(const [name,value] of Object.entries(globals))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});Date.now=()=>time;
  const send=(message,sender=background)=>new Promise(resolve=>{const result=listener({target:'hermo.preview.offscreen',...message},sender,resolve);if(result!==true&&!['frame','status','stop'].includes(message.op))resolve(undefined);});
  const begin=()=>send({op:'start',streamId:'authorized-stream',tabId:7,expiresAt:time+PREVIEW_LEASE_MS,nonce:'only-this-capture'});
  try{
    await import('../companion/browser/preview-offscreen.mjs?offscreen-security');
    let responded=false;listener({target:'hermo.preview.offscreen',op:'start'},{id:extensionId,url:url('popup.html')},()=>responded=true);assert.equal(responded,false);assert.equal(mediaRequests,0,'popup cannot supply or consume capture stream IDs');
    listener({target:'hermo.preview.offscreen',op:'start'},{...background,tab:{id:7}},()=>responded=true);assert.equal(responded,false,'content scripts cannot spoof worker authority');
    assert.equal((await begin()).ok,true);assert.equal(mediaRequests,1);
    assert.equal((await send({op:'frame',nonce:'other-capture'})).ok,false);assert.equal(draws,0,'a different grant cannot sample pixels');
    const first=await send({op:'frame',nonce:'only-this-capture'});assert.equal(first.state,'live');assert.equal(first.captured_at,time);assert.equal(draws,1);assert.equal(canvases[0].width,0);assert.equal(canvases[0].height,0,'pixel backing buffer is cleared after responding');
    time+=1000;const resampled=await send({op:'frame',nonce:'only-this-capture'});assert.equal(resampled.captured_at,first.captured_at,'sampling pixels does not pretend a new video frame arrived');
    time=first.captured_at+PREVIEW_FRAME_FRESH_MS+1;const stale=await send({op:'frame',nonce:'only-this-capture'});assert.equal(stale.state,'unavailable');assert.equal(stale.image,undefined);
    assert.equal((await send({op:'status',nonce:'only-this-capture'})).state,'unavailable');const drawCount=draws;
    for(let i=0;i<3;i++){time+=1000;assert.equal((await send({op:'frame',nonce:'only-this-capture'})).image,undefined);}assert.equal(draws,drawCount,'polling cannot recapture a stalled last frame');
    videos[0].deliver();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).state,'live','a newly decoded frame recovers freshness');
    tracks[0].muted=true;tracks[0].mute();videos[0].deliver();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).image,undefined,'muted stream never replays its last pixels');tracks[0].muted=false;videos[0].deliver();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).state,'live');
    videos[0].paused=true;assert.equal((await send({op:'frame',nonce:'only-this-capture'})).state,'unavailable');videos[0].paused=false;videos[0].deliver();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).state,'live');
    tracks[0].readyState='ended';assert.equal((await send({op:'frame',nonce:'only-this-capture'})).image,undefined);tracks[0].readyState='live';videos[0].deliver();
    time+=PREVIEW_IDLE_MS+1;tick();assert.equal(tracksStopped,1,'idle limit stops video even without another message');assert.equal((await send({op:'frame',nonce:'only-this-capture'})).ok,false);
    assert.equal((await begin()).ok,true);const expiry=time+PREVIEW_LEASE_MS;
    while(time+PREVIEW_IDLE_MS<expiry){time+=PREVIEW_IDLE_MS-1;videos.at(-1).deliver();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).state,'live');}
    time=expiry+1;tick();assert.equal(tracksStopped,2,'active frame polling never extends the hard authorization deadline');assert.equal((await send({op:'status',nonce:'only-this-capture'})).ok,false);
    assert.equal((await begin()).ok,true);assert.equal((await send({op:'stop',nonce:'only-this-capture'})).ok,true);assert.equal(tracksStopped,3);
    counterOnly=true;assert.equal((await begin()).ok,true);
    assert.equal((await send({op:'frame',nonce:'only-this-capture'})).state,'starting','capture waits for a decoded-frame observation when composition callbacks are absent');
    tick();const decoded=await send({op:'frame',nonce:'only-this-capture'});assert.equal(decoded.state,'live');
    time+=1000;tick();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).captured_at,decoded.captured_at,'an unchanged decoded-frame counter never refreshes old pixels');
    time+=PREVIEW_FRAME_FRESH_MS;tick();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).image,undefined,'counter-only capture becomes unavailable when decoding stalls');
    videos.at(-1).decode();tick();const recovered=await send({op:'frame',nonce:'only-this-capture'});assert.equal(recovered.state,'live');assert.equal(recovered.captured_at,time,'only a newly decoded frame restores availability');
    tracks.at(-1).muted=true;tracks.at(-1).mute();videos.at(-1).decode();tick();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).image,undefined);
    tracks.at(-1).muted=false;tick();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).image,undefined,'unmuting cannot reuse a frame decoded while muted');
    videos.at(-1).decode();tick();assert.equal((await send({op:'frame',nonce:'only-this-capture'})).state,'live');
    assert.equal((await send({op:'stop',nonce:'only-this-capture'})).ok,true);assert.equal(tracksStopped,4);
  }finally{
    Date.now=originalNow;for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  }
});
