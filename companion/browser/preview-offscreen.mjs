import {PREVIEW_FRAME_LIMIT,PREVIEW_LEASE_MS,PREVIEW_IDLE_MS,PREVIEW_FRAME_FRESH_MS} from './live-preview.mjs';

let capture,epoch=0;
function stop(){
  ++epoch;const previous=capture;capture=undefined;
  if(!previous)return;
  clearInterval(previous.timer);if(previous.observer!==undefined)previous.video.cancelVideoFrameCallback?.(previous.observer);previous.video.pause();previous.video.srcObject=null;
  previous.stream?.getTracks().forEach(track=>track.stop());
  previous.canvas.width=previous.canvas.height=0;
}
async function start(message){
  stop();const currentEpoch=epoch;
  if(typeof message.streamId!=='string'||message.streamId.length>4096||!Number.isInteger(message.tabId)||!Number.isFinite(message.expiresAt)||message.expiresAt<=Date.now()||message.expiresAt>Date.now()+PREVIEW_LEASE_MS+1000||typeof message.nonce!=='string'||message.nonce.length>64)return {ok:false};
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId,minFrameRate:5,maxFrameRate:10}}});
  if(epoch!==currentEpoch){stream.getTracks().forEach(track=>track.stop());return {ok:false};}
  const video=document.createElement('video'),canvas=document.createElement('canvas');
  video.muted=true;video.playsInline=true;video.srcObject=stream;
  if(typeof video.requestVideoFrameCallback!=='function'&&typeof video.getVideoPlaybackQuality!=='function'){stream.getTracks().forEach(track=>track.stop());return {ok:false};}
  const value={stream,video,canvas,nonce:message.nonce,expiresAt:message.expiresAt,lastRequest:Date.now(),decodedAt:0,presentedFrames:-1,decodedFrames:0};capture=value;
  const available=()=>!video.paused&&stream.getVideoTracks().every(track=>track.readyState==='live'&&!track.muted);
  // Offscreen documents need not composite their video element, so Chrome may
  // never deliver requestVideoFrameCallback. The decoded-frame counter still
  // advances for the actual stream. Observe changes independently of requests;
  // repeatedly sampling the same decoded frame never refreshes its timestamp.
  const observeDecoded=()=>{
    if(capture!==value)return;
    // Use total frames, including those not presented by the compositor: an
    // offscreen document drops presentation even while its video supplies new
    // decoded pixels to drawImage. A stalled stream stops this counter too.
    const frames=video.getVideoPlaybackQuality?.().totalVideoFrames;
    if(!available())value.decodedAt=0;
    if(Number.isFinite(frames)&&frames>value.decodedFrames){
      value.decodedFrames=frames;if(available())value.decodedAt=Date.now();
    }
  };
  const observe=(_,metadata)=>{
    if(capture!==value)return;
    if(!available())value.decodedAt=0;
    else if(Number.isFinite(metadata.presentedFrames)&&metadata.presentedFrames>value.presentedFrames){
      value.presentedFrames=metadata.presentedFrames;value.decodedAt=Date.now();
    }
    value.observer=video.requestVideoFrameCallback(observe);
  };
  value.observer=video.requestVideoFrameCallback?.(observe);
  for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(capture===value)stop();},{once:true});
  for(const track of stream.getVideoTracks())for(const event of ['mute','unmute'])track.addEventListener(event,()=>{if(capture===value)value.decodedAt=0;});
  // Expiration is enforced in the document holding the stream, independently
  // of the dashboard and service-worker lifetime.
  value.timer=setInterval(()=>{if(Date.now()>=value.expiresAt||Date.now()-value.lastRequest>=PREVIEW_IDLE_MS)stop();else observeDecoded();},200);
  try{await video.play();}catch{if(capture===value)stop();return {ok:false};}
  return {ok:capture===value};
}
function state(value){
  const tracks=value.stream.getVideoTracks();
  if(!tracks.length||tracks.some(track=>track.readyState!=='live'||track.muted)||value.video.paused)return 'unavailable';
  if(value.video.readyState<2||!value.video.videoWidth||!value.video.videoHeight||!value.decodedAt)return value.presentedFrames<0&&!value.decodedFrames?'starting':'unavailable';
  if(Date.now()-value.decodedAt>PREVIEW_FRAME_FRESH_MS)return 'unavailable';
  return 'live';
}
function frame(message){
  const value=capture;
  if(!value||message.nonce!==value.nonce)return {ok:false};
  if(Date.now()>=value.expiresAt||Date.now()-value.lastRequest>=PREVIEW_IDLE_MS){stop();return {ok:false};}
  const availability=state(value);if(availability!=='live')return {ok:true,state:availability};
  value.lastRequest=Date.now();
  const capturedAt=value.decodedAt;
  const scale=Math.min(1,1600/value.video.videoWidth,1000/value.video.videoHeight);
  let width=Math.max(1,Math.round(value.video.videoWidth*scale)),height=Math.max(1,Math.round(value.video.videoHeight*scale));
  const context=value.canvas.getContext('2d',{alpha:false});
  if(!context)return {ok:false};
  // Return a newly sampled frame only. No cached screenshot/history is kept.
  let image;
  for(let attempt=0;attempt<5;attempt++){
    value.canvas.width=width;value.canvas.height=height;context.drawImage(value.video,0,0,width,height);
    image=value.canvas.toDataURL('image/jpeg',attempt===0?.75:.55);
    if(image.length<=PREVIEW_FRAME_LIMIT)break;
    width=Math.max(1,Math.round(width*.75));height=Math.max(1,Math.round(height*.75));
  }
  value.canvas.width=value.canvas.height=0;
  if(!image?.startsWith('data:image/jpeg;base64,')||image.length>PREVIEW_FRAME_LIMIT)return {ok:false};
  return {ok:true,state:'live',image,captured_at:capturedAt,width,height};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.target!=='hermo.preview.offscreen')return;
  // Only our background worker may supply capture IDs or retrieve frames.
  if(sender.id!==chrome.runtime.id||sender.tab||sender.url!==chrome.runtime.getURL('background.mjs'))return;
  if(message.op==='start'){start(message).then(respond,()=>{stop();respond({ok:false});});return true;}
  if(message.op==='frame'){try{respond(frame(message));}catch{stop();respond({ok:false});}return;}
  if(message.op==='status'){
    if(capture&&(Date.now()>=capture.expiresAt||Date.now()-capture.lastRequest>=PREVIEW_IDLE_MS))stop();
    respond(capture&&message.nonce===capture.nonce?{ok:true,state:state(capture)}:{ok:false});return;
  }
  if(message.op==='stop'&&(!capture||message.nonce===capture.nonce)){stop();respond({ok:true});}
});
addEventListener('pagehide',stop);
