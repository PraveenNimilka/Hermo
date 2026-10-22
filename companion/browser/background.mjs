import {renderPanel} from './panel.mjs';
import {inspectDocument} from './inspect.mjs';
import {executeBrowserCommand} from './commands.mjs';
import {createLivePreview} from './live-preview.mjs';
import {createBrowserIdentity} from './browser-identity.mjs';

// Session storage survives MV3 suspension, never a Chrome restart. Only trusted
// extension contexts can access these scoped grants; no website credentials.
const sessions=new Map(),pairing=new Set(),storageKey='hermoScopedBrowserSessions',alarmName='hermo.connection.recover';let generation=Date.now(),storageQueue=Promise.resolve();
const livePreview=createLivePreview({chrome});
const browserIdentity=createBrowserIdentity(chrome.storage.local);
const nextGeneration=()=>generation=Math.max(Date.now(),generation+1);
globalThis.hermoConnectionStates={};
const allowedErrors=new Set(['TAB_CLOSED','ORIGIN_CHANGED','LOGIN_REQUIRED','ACTION_UNAVAILABLE','ELEMENT_AMBIGUOUS','ELEMENT_CHANGED','COMPLETION_CHANGED','OUTPUT_LIMIT_EXCEEDED','UNSUPPORTED_FRAME','TIMEOUT','PERMISSION_REVOKED','PAGE_READ_FAILED','MEDIA_UNSUPPORTED','MEDIA_TOO_LARGE','INVALID_PROBE','PROBE_LIMIT','PROBE_UNAVAILABLE']);
const terminalReason={TAB_CLOSED:'tab_closed',ORIGIN_CHANGED:'origin_changed',PERMISSION_REVOKED:'permission_revoked'};
function inScope(url,session){try{const source=new URL(url);return source.origin===session.origin&&source.pathname.startsWith(session.pathPrefix);}catch{return false;}}
function report(session,state){globalThis.hermoConnectionStates[session.tabId]={state,origin:session.origin,name:session.name??'',generation:session.generation};}
function persist(){
  const save=async()=>{
    const values=[...sessions.values()].filter(s=>!s.stopped).map(({tabId,origin,workspace,pathPrefix,id,generation,state,name,token,leaseExpiresAt,inFlight})=>({tabId,origin,workspace,pathPrefix,id,generation,state,name,token,leaseExpiresAt,...inFlight?{inFlight}:{}}));
    await chrome.storage.session.set({[storageKey]:values});
    if(values.length){if(!await chrome.alarms.get(alarmName))await chrome.alarms.create(alarmName,{periodInMinutes:0.5});}else await chrome.alarms.clear(alarmName);
  };
  storageQueue=storageQueue.catch(()=>{}).then(save);return storageQueue;
}
async function panel(session,state=session.state){
  if(session.stopped&&!['stopped','offline'].includes(state))return;
  const revision=nextGeneration();session.generation=revision;session.state=state;report(session,state);
  try{const selected=await chrome.tabs.get(session.tabId);if(!inScope(selected.url,session))return;
    await chrome.scripting.executeScript({target:{tabId:session.tabId},world:'ISOLATED',func:renderPanel,args:[{state,name:session.name,controller:session.id,generation:revision}]});
  }catch{}
}
async function call(session,path,body,signal=session.abort.signal){
  const request=new AbortController(),cancel=()=>request.abort();
  if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  const timeout=setTimeout(cancel,25000);
  try{
    const response=await fetch(session.workspace+path,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-hermo-extension-id':chrome.runtime.id,...session.token?{authorization:'Bearer '+session.token}:{}},body:JSON.stringify(body),signal:request.signal});
    const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error?.message??'The local connection ended.'),{code:value.error?.code,status:response.status});return value;
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);}
}
async function end(session,state='stopped',reason='user'){
  if(session.stopped)return;session.stopped=true;clearInterval(session.heartbeat);
  session.abort.abort();sessions.delete(session.tabId);
  await livePreview.stop(session);await panel(session,state);
  try{await persist();}catch{}
  try{if(session.token)await call(session,'/companion/browser/disconnect',{reason},AbortSignal.timeout(3000));}catch{}
  session.token=undefined;
}
async function idlePoll(session){
  for(let attempt=0;;attempt++){
    try{return await call(session,'/companion/browser/poll',{});}catch(error){
      if(session.stopped||error.status||attempt>=2)throw error;
      await panel(session,'reconnecting');
      await new Promise(done=>{const finish=()=>{clearTimeout(timer);session.abort.signal.removeEventListener('abort',finish);done();},timer=setTimeout(finish,500*2**attempt);session.abort.signal.addEventListener('abort',finish,{once:true});});
      if(session.stopped)throw error;
    }
  }
}
async function poll(session){
  let reason='transport_lost';
  try{
    while(!session.stopped){
      if(session.leaseExpiresAt<=Date.now())break;
      const message=await idlePoll(session);if(session.stopped)break;if(message.type==='closed')break;
      const idleState=message.connection_status==='connected'?'ready':'pending';await panel(session,idleState);
      if(session.stopped)break;if(message.type!=='command')continue;
      // Persist before execution. A restarted worker must never replay a command
      // whose browser-side effect may already have happened.
      session.inFlight={id:message.id,expiresAt:message.expires_at};await persist();
      if(session.stopped)break;await panel(session,'running');if(session.stopped)break;let value,error;
      try{
        if(message.origin!==session.origin||message.path_prefix!==session.pathPrefix||message.expires_at<=Date.now())throw Error('TIMEOUT');
        value=await executeBrowserCommand({chrome,tabId:session.tabId,origin:session.origin,pathPrefix:session.pathPrefix,command:message.command,inspect:inspectDocument,signal:session.abort.signal,deadline:message.expires_at,getVisualFrame:()=>livePreview.getFrame(session),beforeMutation:async()=>{await call(session,'/companion/browser/authorize',{id:message.id});}});
      }catch(problem){error=problem.code==='BROWSER_COMMAND_CANCELLED'?'ACTION_UNAVAILABLE':allowedErrors.has(problem.message)?problem.message:'PAGE_READ_FAILED';}
      if(session.stopped)break;
      // A failed reply never reruns a command: a submission may have happened.
      reason='outcome_unknown';await call(session,'/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}});
      session.inFlight=undefined;await persist();reason='transport_lost';
      await panel(session,terminalReason[error]?'offline':idleState);
      if(terminalReason[error]){reason=terminalReason[error];break;}
    }
  }catch{if(session.inFlight)reason='outcome_unknown';}finally{await end(session,session.stopped?'stopped':'offline',reason);}
}
function start(session){
  session.heartbeat=setInterval(async()=>{if(session.refreshing||session.stopped)return;session.refreshing=true;try{if(session.leaseExpiresAt<=Date.now()){await end(session,'offline','transport_lost');return;}const selected=await chrome.tabs.get(session.tabId);if(!inScope(selected.url,session)){await end(session,'offline','origin_changed');return;}await panel(session);}catch{await end(session,'offline','tab_closed');}finally{session.refreshing=false;}},4000);
  void poll(session);
}
async function restore(){
  await livePreview.reset();
  await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const saved=(await chrome.storage.session.get(storageKey))[storageKey];if(!Array.isArray(saved))return;
  for(const value of saved.slice(0,30)){
    try{
      if(!Number.isInteger(value.tabId)||sessions.has(value.tabId)||!/^hb_session_[A-Za-z0-9_-]{43}$/.test(value.token)||!Number.isFinite(value.leaseExpiresAt))continue;
      const workspace=new URL(value.workspace),website=new URL(value.origin);
      if(workspace.protocol!=='http:'||workspace.hostname!=='127.0.0.1'||workspace.origin!==value.workspace||website.origin!==value.origin||!['http:','https:'].includes(website.protocol)||value.pathPrefix!==(value.origin===value.workspace?'/sandbox/':'/'))continue;
      const session={...value,abort:new AbortController(),stopped:false,state:'reconnecting'};sessions.set(session.tabId,session);
      if(session.inFlight){await end(session,'offline','outcome_unknown');continue;}
      if(session.leaseExpiresAt<=Date.now()){await end(session,'offline','transport_lost');continue;}
      const tab=await chrome.tabs.get(session.tabId);if(tab.incognito||!inScope(tab.url,session)){await end(session,'offline','origin_changed');continue;}
      await panel(session,'reconnecting');start(session);
    }catch{const session=sessions.get(value.tabId);if(session)await end(session,'offline','tab_closed');}
  }
  await persist();
}
const ready=restore().catch(async()=>{for(const session of [...sessions.values()])await end(session,'offline','transport_lost');});
async function pair(message){
  await ready;
  if(!Number.isInteger(message.tabId)||message.tabId<1||message.authorized!==true||!/^hb_pair_[A-Za-z0-9_-]{43}$/.test(message.code??''))throw Error('Copy a fresh pairing code and authorize the selected tab.');
  const workspace=new URL(message.workspace),website=new URL(message.origin);
  if(workspace.protocol!=='http:'||workspace.hostname!=='127.0.0.1'||workspace.username||workspace.password||workspace.pathname!=='/'||workspace.search||workspace.hash||!['http:','https:'].includes(website.protocol)||website.origin!==message.origin)throw Error('Invalid local Hermo address or website.');
  if(pairing.has(message.tabId))throw Error('This tab is already connecting.');pairing.add(message.tabId);
  const session={tabId:message.tabId,origin:website.origin,workspace:workspace.origin,pathPrefix:website.origin===workspace.origin?'/sandbox/':'/',id:crypto.randomUUID(),generation:nextGeneration(),state:'pending',abort:new AbortController(),stopped:false};
  try{
    const selected=await chrome.tabs.get(session.tabId);if(selected.incognito||!inScope(selected.url,session))throw Error('Open the selected website in a normal Chrome tab first.');
    await executeBrowserCommand({chrome,tabId:session.tabId,origin:session.origin,pathPrefix:session.pathPrefix,command:{op:'snapshot'},inspect:inspectDocument});
    if(sessions.has(session.tabId))await end(sessions.get(session.tabId));
    const context=await browserIdentity();
    const linked=await call(session,'/companion/browser/pair',{code:message.code,origin:session.origin,authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs','live_preview','semantic_target_guard','completion_evidence','locator_probe','extended_waits','typed_outputs','preview_interaction','local_media'],context_id:context,tab_id:session.tabId},AbortSignal.timeout(15000));
    session.token=linked.token;if(linked.path_prefix!==session.pathPrefix)throw Error('The website scope was not accepted.');session.name=linked.app_name;session.state=linked.connection_status==='connected'?'ready':'pending';session.leaseExpiresAt=Number.isFinite(linked.lease_expires_at)?linked.lease_expires_at:Date.now()+4*3600000;
    sessions.set(session.tabId,session);await persist();await panel(session);start(session);return {ok:true,origin:session.origin};
  }catch(error){await end(session,'offline','transport_lost');throw error;}finally{pairing.delete(message.tabId);}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='hermo.browser.identity'){
    if(sender.id!==chrome.runtime.id||sender.url?.split('#')[0]!==chrome.runtime.getURL('controller.html'))return;
    browserIdentity().then(context_id=>respond({ok:true,context_id}),()=>respond({ok:false}));return true;
  }
  if(['hermo.preview.status','hermo.preview.start','hermo.preview.stop'].includes(message?.type)){
    if(sender.id!==chrome.runtime.id||sender.tab||sender.url!==chrome.runtime.getURL('popup.html'))return;
    ready.then(async()=>{
      const session=sessions.get(message.tabId);
      if(!session||session.stopped){respond({ok:false,state:'disabled',error:'Connect this website tab to Hermo first.'});return;}
      const tab=await chrome.tabs.get(session.tabId);if(!inScope(tab.url,session)){await end(session,'offline','origin_changed');respond({ok:false,state:'disabled'});return;}
      let preview;
      if(message.type==='hermo.preview.start')preview=await livePreview.start(session);
      else if(message.type==='hermo.preview.stop'){await livePreview.stop(session);preview={state:'disabled'};}
      else preview=await livePreview.status(session);
      respond({ok:true,...preview,connection_state:session.state,connection_name:session.name??''});
    }).catch(error=>respond({ok:false,state:'unavailable',error:error instanceof Error?error.message:'Live preview is unavailable.'}));return true;
  }
  if(message?.type==='hermo.pair'){
    if(sender.id!==chrome.runtime.id||sender.tab||!['popup.html','connect.html'].some(path=>sender.url?.startsWith(chrome.runtime.getURL(path))))return;
    pair(message).then(respond,error=>respond({ok:false,error:error.message,code:error.code}));return true;
  }
  if(message?.type==='hermo.panel.stop'){
    ready.then(()=>{const session=sessions.get(sender.tab?.id);if(!session||message.controller!==session.id||sender.id!==chrome.runtime.id||!inScope(sender.url,session)){respond({ok:false});return;}return end(session).then(()=>respond({ok:true}));});return true;
  }
  if(message?.type==='hermo.popup.stop'){
    if(sender.id!==chrome.runtime.id||sender.tab||sender.url!==chrome.runtime.getURL('popup.html'))return;
    ready.then(async()=>{
      const session=sessions.get(message.tabId);
      if(!session||session.stopped){respond({ok:false});return;}
      const [tab,selected]=await Promise.all([chrome.tabs.get(session.tabId),chrome.tabs.query({active:true,currentWindow:true})]);
      if(selected.length!==1||selected[0].id!==session.tabId||tab.incognito||!inScope(tab.url,session)){respond({ok:false});return;}
      await end(session);respond({ok:true});
    }).catch(()=>respond({ok:false}));return true;
  }
});
chrome.tabs.onRemoved.addListener(tabId=>{void ready.then(()=>{const session=sessions.get(tabId);if(session)void end(session,'offline','tab_closed');delete globalThis.hermoConnectionStates[tabId];});});
chrome.tabs.onUpdated.addListener((tabId,change)=>{void ready.then(()=>{const session=sessions.get(tabId);if(session&&change.url&&!inScope(change.url,session))void end(session,'offline','origin_changed');});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===alarmName)void ready;});
