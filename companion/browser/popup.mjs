import {executeBrowserCommand} from './commands.mjs';
import {inspectDocument} from './inspect.mjs';
document.body.classList.add('popup');
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.inputMethod='pointer';},true);
document.addEventListener('keydown',event=>{if(event.key==='Tab')document.documentElement.dataset.inputMethod='keyboard';},true);
const connectionPage=Object.hasOwn(globalThis,'hermoConnectionPageTarget');
const tab=connectionPage?(globalThis.hermoConnectionPageTarget?await chrome.tabs.get(globalThis.hermoConnectionPageTarget.tabId).catch(()=>null):null):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
let website;
try{if(chrome.extension.inIncognitoContext)throw Error();website=new URL(tab?.url);if(connectionPage&&website.origin!==globalThis.hermoConnectionPageTarget.origin)throw Error();if(!['https:','http:'].includes(website.protocol))throw Error();document.querySelector('#website').textContent=website.origin;}catch{document.querySelector('#website').textContent='Open a website in a normal Chrome tab first. Incognito and browser-internal tabs are unsupported.';document.querySelector('#connect').disabled=true;}
const remembered=await chrome.storage.local.get('workspace');if(remembered.workspace)document.querySelector('#workspace').value=remembered.workspace;
const setupGuide=document.querySelector('#setup-guide');
function workspaceURL(){const workspace=new URL(document.querySelector('#workspace').value);if(workspace.protocol!=='http:'||workspace.hostname!=='127.0.0.1'||workspace.username||workspace.password||workspace.pathname!=='/'||workspace.search||workspace.hash)throw Error('Use your local http://127.0.0.1 Hermo address.');return workspace;}
function updateGuide(){try{if(setupGuide)setupGuide.href=workspaceURL().origin+'/connected-browser.html';}catch{}}
updateGuide();document.querySelector('#workspace').addEventListener('input',updateGuide);
let connected=false,connectionInfo;
function showConnection(value){
  if(connectionPage)return;
  connected=!!value?.ok;connectionInfo=value;
  document.body.dataset.connection=connected?'connected':'disconnected';
  document.querySelector('#pair').hidden=connected;
  document.querySelector('#connected-state').hidden=!connected;
  document.querySelector('#cancel-reconnect').hidden=true;
  if(connected){document.querySelector('#authorize').checked=false;document.querySelector('#code').value='';document.querySelector('#status').textContent='';}
  document.querySelector('#connection-label').textContent=connected?'Connected':'Companion';
  document.querySelector('#companion-heading').textContent=connected?'Right here with you.':'A little help, right here.';
  document.querySelector('#companion-description').textContent=connected?'Your website and workspace, connected.':'Connect this tab to your local workspace.';
  document.querySelector('#connection-name').textContent=value?.connection_name||'This tab is connected';
}
document.querySelector('#open-workspace')?.addEventListener('click',async()=>{try{await chrome.tabs.create({url:workspaceURL().origin,active:true});}catch{document.querySelector('#status').textContent='Check your local runtime address before opening Hermo.';}});
document.querySelector('#reconnect-tab')?.addEventListener('click',()=>{
  document.querySelector('#authorize').checked=false;document.querySelector('#code').value='';
  document.querySelector('#pair').hidden=false;document.querySelector('#connected-state').hidden=true;document.querySelector('#cancel-reconnect').hidden=false;
  document.querySelector('#companion-heading').textContent='Reconnect this tab';document.querySelector('#companion-description').textContent='Use a fresh code from your Hermo workspace.';document.querySelector('#code').focus();
});
document.querySelector('#cancel-reconnect')?.addEventListener('click',()=>{showConnection(connectionInfo);document.querySelector('#open-workspace').focus();});
document.querySelector('#disconnect-tab')?.addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{const value=await chrome.runtime.sendMessage({type:'hermo.popup.stop',tabId:tab.id});if(!value?.ok)throw Error();showConnection({ok:false});showPreview({ok:false});document.querySelector('#status').textContent='Disconnected. Your website stays open and signed in.';document.querySelector('#code').focus();}
  catch{document.querySelector('#status').textContent='Could not disconnect. Use Stop on the website panel.';}finally{button.disabled=false;}
});
const reconnect=document.querySelector('#open-hermo-reconnect');
if(reconnect)reconnect.addEventListener('click',async()=>{
  const workspace=new URL(document.querySelector('#workspace').value);
  if(workspace.protocol==='http:'&&workspace.hostname==='127.0.0.1'&&!workspace.username&&!workspace.password)await chrome.tabs.create({url:workspace.origin+'/#connections',active:true});
});
const previewEnable=document.querySelector('#preview-enable'),previewStop=document.querySelector('#preview-stop'),previewStatus=document.querySelector('#preview-status');
function showPreview(value){
  if(!previewEnable||!previewStop||!previewStatus)return;
  const sharing=value?.ok&&['live','starting','unavailable'].includes(value.state);
  previewEnable.disabled=!value?.ok;previewStop.hidden=!sharing;previewEnable.hidden=value?.state==='live';
  const region=document.querySelector('#live-preview'),label=document.querySelector('#preview-label');if(region)region.dataset.preview=value?.state??'disabled';if(label)label.textContent=value?.state==='live'?'Live':value?.state==='starting'?'Starting':'Off';
  previewStatus.textContent=value?.state==='live'?'Live preview enabled. Return to Hermo; this popup can close.':value?.ok&&value.state==='starting'?'Starting preview. You can stop sharing at any time.':value?.ok&&value.state==='unavailable'?'Preview interrupted. Stop sharing or enable it again on this website tab.':value?.ok?'Preview is off. Enable it to see the real website inside Hermo.':value?.error??'Connect this tab first.';
}
async function refreshPreview(){
  if(!previewEnable||connectionPage||!website||!tab?.id)return;
  try{const value=await chrome.runtime.sendMessage({type:'hermo.preview.status',tabId:tab.id});showConnection(value);showPreview(value);}catch{showPreview({ok:false,error:'Reload the updated companion and reconnect this tab.'});}
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
  event.preventDefault();const button=document.querySelector('#connect'),status=document.querySelector('#status');button.disabled=true;button.textContent='Connecting…';event.currentTarget.setAttribute('aria-busy','true');document.body.dataset.connection='connecting';status.textContent='';status.dataset.kind='';if(reconnect)reconnect.hidden=true;
  try{
    const workspace=workspaceURL(),code=document.querySelector('#code').value.trim();
    if(!/^hb_pair_[A-Za-z0-9_-]{43}$/.test(code)||!document.querySelector('#authorize').checked)throw Error('Copy a fresh pairing code from Hermo and authorize this tab.');
    if(!website||!tab?.id)throw Error('Open the website tab before pairing.');
    await chrome.storage.local.set({workspace:workspace.origin});
    if(connectionPage){
      const handoff=crypto.randomUUID();await chrome.storage.session.set({['pendingPair:'+handoff]:{workspace:workspace.origin,code,tabId:tab.id,origin:website.origin,expires:Date.now()+30000}});
      await chrome.tabs.create({url:chrome.runtime.getURL('controller.html')+'#'+handoff,active:false});
      status.textContent='Connected using the manual controller. Keep its tab open and check the connection in Hermo.';
    }else{
      const result=await chrome.runtime.sendMessage({type:'hermo.pair',workspace:workspace.origin,code,tabId:tab.id,origin:website.origin,authorized:true});
      if(!result?.ok){
        if(result?.code==='WRONG_BROWSER'){document.querySelector('#code').value='';if(reconnect)reconnect.hidden=false;}
        throw Error(result?.error??'The selected tab could not connect.');
      }
      await refreshPreview();
      document.querySelector('#open-workspace')?.focus();
    }
    document.querySelector('#code').value='';
  }catch(error){status.dataset.kind='error';status.textContent=error instanceof Error?error.message:'The tab could not connect.';}
  finally{button.disabled=false;button.textContent='Connect selected tab';document.querySelector('#pair').removeAttribute('aria-busy');document.body.dataset.connection=connected?'connected':'disconnected';}
});
document.querySelector('#inspect-chat').addEventListener('click',async()=>{
 const button=document.querySelector('#inspect-chat'),status=document.querySelector('#diagnostic-status');button.disabled=true;
 try{
  if(!website||website.origin!=='https://chatgpt.com'||!tab.id||chrome.extension.inIncognitoContext)throw Error('Open the supported conversation tab first, then open this extension.');
  const fields=await (await fetch(chrome.runtime.getURL('diagnostic-fields.json'),{cache:'no-store'})).json();
  const report=await executeBrowserCommand({chrome,tabId:tab.id,origin:website.origin,command:{op:'diagnose_chat',fields},inspect:inspectDocument});
  const box=document.querySelector('#diagnostic-report');box.value=JSON.stringify({...report,companionVersion:chrome.runtime.getManifest().version},null,2);box.hidden=false;document.querySelector('#copy-diagnostics').hidden=false;status.textContent='Layout inspected. Copy this report and paste it into your Hermo support conversation.';
 }catch(error){status.textContent=error instanceof Error?error.message:'Could not inspect this conversation.';}finally{button.disabled=false;}
});
document.querySelector('#copy-diagnostics').addEventListener('click',async()=>{
 const box=document.querySelector('#diagnostic-report');try{await navigator.clipboard.writeText(box.value);document.querySelector('#diagnostic-status').textContent='Diagnostics copied.';}catch{box.focus();box.select();document.querySelector('#diagnostic-status').textContent='Report selected. Press Ctrl+C to copy.';}
});
document.documentElement.dataset.hermoReady='true';
