import {renderPanel} from './panel.mjs';
import {inspectDocument} from './inspect.mjs';
import {executeBrowserCommand} from './commands.mjs';
import {browserProblem} from './status.mjs';
const status=document.querySelector('#status');let panelState='pending',panelName='',controllerId=crypto.randomUUID(),generation=Date.now(),heartbeat;let stopped=false,inFlight=false,token,pair,abort=new AbortController();
async function panel(state=panelState){panelState=state;try{if(!pair)return;const selected=await chrome.tabs.get(pair.tabId);if(new URL(selected.url).origin!==pair.origin||!new URL(selected.url).pathname.startsWith(pair.pathPrefix??'/'))return;await chrome.scripting.executeScript({target:{tabId:pair.tabId},world:'ISOLATED',func:renderPanel,args:[{state,name:panelName,controller:controllerId,generation}]});}catch{}}
async function stop(){if(stopped)return;stopped=true;clearInterval(heartbeat);abort.abort();panel('stopped');try{if(token)await call('/companion/browser/disconnect',{reason:'user'},AbortSignal.timeout(3000));}catch{}token=undefined;status.textContent='Stopped. Your browser, saved setup and website sign-in remain available.';}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='hermo.panel.stop'||message.controller!==controllerId||sender.tab?.id!==pair?.tabId)return;
  let source;try{source=new URL(sender.url);}catch{return;}if(source.origin!==pair.origin||!source.pathname.startsWith(pair.pathPrefix??'/'))return;
  stop().then(()=>respond({ok:true}));return true;
});
window.addEventListener('pagehide',()=>{stopped=true;if(token&&pair)fetch(pair.workspace+'/companion/browser/disconnect',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',keepalive:true,headers:{'content-type':'application/json','x-hermo-extension-id':chrome.runtime.id,authorization:'Bearer '+token},body:JSON.stringify({reason:inFlight?'outcome_unknown':'user'})}).catch(()=>{});abort.abort();token=undefined;});
async function call(path,body,signal=abort.signal){
  const response=await fetch(pair.workspace+path,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-hermo-extension-id':chrome.runtime.id,...token?{authorization:'Bearer '+token}:{}},body:JSON.stringify(body),signal});
  const value=await response.json();if(!response.ok)throw Error(value.error?.message??'The local connection ended.');return value;
}
document.querySelector('#stop').addEventListener('click',stop);
try{
  const handoff='pendingPair:'+location.hash.slice(1),stored=await chrome.storage.session.get(handoff);pair=stored[handoff];await chrome.storage.session.remove(handoff);
  if(!pair||pair.expires<Date.now())throw Error('No fresh pairing request is available. Generate a code in Hermo and pair the website tab.');
  const workspace=new URL(pair.workspace);if(workspace.protocol!=='http:'||workspace.hostname!=='127.0.0.1'||workspace.username||workspace.password||workspace.pathname!=='/'||workspace.search||workspace.hash)throw Error('Invalid local Hermo address.');
  // Verify the selected tab is readable before consuming the one-use code.
  const pathPrefix=pair.origin===pair.workspace?'/sandbox/':'/';
  await executeBrowserCommand({chrome,tabId:pair.tabId,origin:pair.origin,pathPrefix,command:{op:'snapshot'},inspect:inspectDocument});
  const local=await chrome.storage.local.get('browserContext');const browserContext=local.browserContext??('bc_'+crypto.randomUUID());if(!local.browserContext)await chrome.storage.local.set({browserContext});
  const linked=await call('/companion/browser/pair',{code:pair.code,origin:pair.origin,authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs'],context_id:browserContext,tab_id:pair.tabId});pair.code=undefined;token=linked.token;pair.pathPrefix=pair.origin===pair.workspace?'/sandbox/':'/';if(linked.path_prefix!==pair.pathPrefix)throw Error('The browser scope was not accepted.');
  panelName=linked.app_name;await panel(linked.connection_status==='connected'?'ready':'pending');heartbeat=setInterval(async()=>{try{const selected=await chrome.tabs.get(pair.tabId);if(new URL(selected.url).origin!==pair.origin||!new URL(selected.url).pathname.startsWith(pair.pathPrefix??'/')){await stop();return;}await panel();}catch{await stop();}},4000);
  document.querySelector('#website').textContent='Connected website: '+pair.origin;status.textContent='Connected to local Hermo. Continue in your website or Hermo; keep this tab open.';
  while(!stopped){
    const message=await call('/companion/browser/poll',{});if(message.type==='closed')break;await panel(message.connection_status==='connected'?'ready':'pending');if(message.type!=='command')continue;await panel('running');
    let value,error;inFlight=true;
    try{if(message.origin!==pair.origin||message.path_prefix!==pair.pathPrefix||message.expires_at<=Date.now())throw Error('TIMEOUT');value=await executeBrowserCommand({chrome,tabId:pair.tabId,origin:pair.origin,pathPrefix:pair.pathPrefix,command:message.command,inspect:inspectDocument,signal:abort.signal,deadline:message.expires_at,beforeMutation:()=>call('/companion/browser/authorize',{id:message.id})});}
    catch(problem){error=['TAB_CLOSED','ORIGIN_CHANGED','LOGIN_REQUIRED','ACTION_UNAVAILABLE','ELEMENT_AMBIGUOUS','OUTPUT_LIMIT_EXCEEDED','UNSUPPORTED_FRAME','TIMEOUT','PERMISSION_REVOKED','PAGE_READ_FAILED'].includes(problem.message)?problem.message:'PAGE_READ_FAILED';status.textContent=browserProblem(error);}
    if(stopped)break;
    await call('/companion/browser/reply',{id:message.id,ok:!error,...error?{error}:{value}});
    inFlight=false;
    await panel(['TAB_CLOSED','ORIGIN_CHANGED','PERMISSION_REVOKED'].includes(error)?'offline':message.connection_status==='connected'?'ready':'pending');
    if(['TAB_CLOSED','ORIGIN_CHANGED','PERMISSION_REVOKED'].includes(error))break;
    if(!error)status.textContent='Connected to local Hermo. Continue in your website or Hermo; keep this tab open.';
  }
  if(!stopped)status.textContent='The local connection ended. Unlock Hermo and pair the selected tab again.';
}catch(error){if(!stopped)status.textContent=error instanceof Error?(/^[A-Z_]+$/.test(error.message)?browserProblem(error.message):error.message):'The browser connection ended.';}
finally{clearInterval(heartbeat);await panel(stopped?'stopped':'offline');if(token&&!stopped)try{await call('/companion/browser/disconnect',{reason:inFlight?'outcome_unknown':'transport_lost'});}catch{}token=undefined;stopped=true;document.querySelector('#stop').disabled=true;}
