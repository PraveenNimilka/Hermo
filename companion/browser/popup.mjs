import {executeBrowserCommand} from './commands.mjs';
import {inspectDocument} from './inspect.mjs';
document.body.classList.add('popup');
const connectionPage=Object.hasOwn(globalThis,'hermoConnectionPageTarget');
const tab=connectionPage?(globalThis.hermoConnectionPageTarget?await chrome.tabs.get(globalThis.hermoConnectionPageTarget.tabId).catch(()=>null):null):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
let website;
try{if(chrome.extension.inIncognitoContext)throw Error();website=new URL(tab?.url);if(connectionPage&&website.origin!==globalThis.hermoConnectionPageTarget.origin)throw Error();if(!['https:','http:'].includes(website.protocol))throw Error();document.querySelector('#website').textContent='Selected website: '+website.origin;}catch{document.querySelector('#website').textContent='Open the website in a normal Chrome profile first, then click this extension. Incognito and browser-internal tabs are unsupported.';document.querySelector('#connect').disabled=true;}
const remembered=await chrome.storage.local.get('workspace');if(remembered.workspace)document.querySelector('#workspace').value=remembered.workspace;
const previewEnable=document.querySelector('#preview-enable'),previewStop=document.querySelector('#preview-stop'),previewStatus=document.querySelector('#preview-status');
function showPreview(value){
  if(!previewEnable||!previewStop||!previewStatus)return;
  previewEnable.disabled=!value?.ok;previewStop.hidden=!value?.ok;previewEnable.hidden=value?.state==='live';
  previewStatus.textContent=value?.state==='live'?'Live preview enabled. Return to Hermo; this popup can close.':value?.ok&&value.state==='starting'?'Starting preview. You can stop sharing at any time.':value?.ok&&value.state==='unavailable'?'Preview interrupted. Stop sharing or enable it again on this website tab.':value?.ok?'Preview is off. Enable it to see the real website inside Hermo.':value?.error??'Connect this tab first.';
}
async function refreshPreview(){
  if(!previewEnable||connectionPage||!website||!tab?.id)return;
  try{showPreview(await chrome.runtime.sendMessage({type:'hermo.preview.status',tabId:tab.id}));}catch{showPreview({ok:false,error:'Reload the updated companion and reconnect this tab.'});}
}
if(previewEnable)previewEnable.addEventListener('click',async()=>{
  previewEnable.disabled=true;
  try{showPreview(await chrome.runtime.sendMessage({type:'hermo.preview.start',tabId:tab.id}));}
  catch{showPreview({ok:false,error:'Chrome could not start the preview. Reopen this popup on the connected website.'});}
  // Failed starts are retryable while the connection remains authorized.
  if(!previewEnable.hidden)previewEnable.disabled=false;
});
if(previewStop)previewStop.addEventListener('click',async()=>{
  previewStop.disabled=true;
  try{showPreview(await chrome.runtime.sendMessage({type:'hermo.preview.stop',tabId:tab.id}));}finally{previewStop.disabled=false;}
});
void refreshPreview();
const openPage=document.querySelector('#open-connection-page');
if(openPage)openPage.addEventListener('click',async()=>{if(!website||!tab?.id)return;const request=crypto.randomUUID();await chrome.storage.session.set({['pairTarget:'+request]:{tabId:tab.id,origin:website.origin,expires:Date.now()+600000}});await chrome.tabs.create({url:chrome.runtime.getURL('connect.html')+'#'+request,active:true});});
document.querySelector('#pair').addEventListener('submit',async event=>{
  event.preventDefault();const button=document.querySelector('#connect'),status=document.querySelector('#status');button.disabled=true;
  try{
    const workspace=new URL(document.querySelector('#workspace').value),code=document.querySelector('#code').value.trim();
    if(workspace.protocol!=='http:'||workspace.hostname!=='127.0.0.1'||workspace.username||workspace.password||workspace.pathname!=='/'||workspace.search||workspace.hash)throw Error('Use your local http://127.0.0.1 Hermo address.');
    if(!/^hb_pair_[A-Za-z0-9_-]{43}$/.test(code)||!document.querySelector('#authorize').checked)throw Error('Copy a fresh pairing code from Hermo and authorize this tab.');
    if(!website||!tab?.id)throw Error('Open the website tab before pairing.');
    await chrome.storage.local.set({workspace:workspace.origin});
    if(connectionPage){
      const handoff=crypto.randomUUID();await chrome.storage.session.set({['pendingPair:'+handoff]:{workspace:workspace.origin,code,tabId:tab.id,origin:website.origin,expires:Date.now()+30000}});
      await chrome.tabs.create({url:chrome.runtime.getURL('controller.html')+'#'+handoff,active:false});
      status.textContent='Connected using the manual controller. Keep its tab open and check the connection in Hermo.';
    }else{
      const result=await chrome.runtime.sendMessage({type:'hermo.pair',workspace:workspace.origin,code,tabId:tab.id,origin:website.origin,authorized:true});
      if(!result?.ok)throw Error(result?.error??'The selected tab could not connect.');
      status.textContent='Your website is connected. Close this popup and create an action in Hermo. No account confirmation is needed. Use Stop on the website to end access.';
      await refreshPreview();
    }
    document.querySelector('#code').value='';
  }catch(error){status.textContent=error instanceof Error?error.message:'The tab could not connect.';}
  finally{button.disabled=false;}
});
document.querySelector('#inspect-chat').addEventListener('click',async()=>{
 const button=document.querySelector('#inspect-chat'),status=document.querySelector('#diagnostic-status');button.disabled=true;
 try{
  if(!website||website.origin!=='https://chatgpt.com'||!tab.id||chrome.extension.inIncognitoContext)throw Error('Open your ChatGPT conversation tab first, then open this extension.');
  const fields=await (await fetch(chrome.runtime.getURL('diagnostic-fields.json'),{cache:'no-store'})).json();
  const report=await executeBrowserCommand({chrome,tabId:tab.id,origin:website.origin,command:{op:'diagnose_chat',fields},inspect:inspectDocument});
  const box=document.querySelector('#diagnostic-report');box.value=JSON.stringify({...report,companionVersion:chrome.runtime.getManifest().version},null,2);box.hidden=false;document.querySelector('#copy-diagnostics').hidden=false;status.textContent='Layout inspected. Copy this report and paste it into your Hermo support conversation.';
 }catch(error){status.textContent=error instanceof Error?error.message:'Could not inspect this conversation.';}finally{button.disabled=false;}
});
document.querySelector('#copy-diagnostics').addEventListener('click',async()=>{
 const box=document.querySelector('#diagnostic-report');try{await navigator.clipboard.writeText(box.value);document.querySelector('#diagnostic-status').textContent='Diagnostics copied.';}catch{box.focus();box.select();document.querySelector('#diagnostic-status').textContent='Report selected. Press Ctrl+C to copy.';}
});
document.documentElement.dataset.hermoReady='true';
