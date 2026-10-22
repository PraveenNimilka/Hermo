// Visual access is a separate, short-lived opt-in. Nothing about the stream or
// its frames is persisted, and recovering an automation session never restores it.
export const PREVIEW_LEASE_MS=15*60*1000;
export const PREVIEW_IDLE_MS=2*60*1000;
export const PREVIEW_FRAME_LIMIT=600000;
export const PREVIEW_FRAME_FRESH_MS=4000;

export function createLivePreview({chrome,now=Date.now}){
  const documentURL=chrome.runtime.getURL('preview-offscreen.html');
  let active,desired,epoch=0,creation,operations=Promise.resolve();
  const failures=new Map();
  const inScope=(tab,session)=>{try{const url=new URL(tab.url);return !tab.incognito&&url.origin===session.origin&&url.pathname.startsWith(session.pathPrefix??'/');}catch{return false;}};
  const supported=()=>Boolean(chrome.tabCapture?.getMediaStreamId&&chrome.offscreen?.createDocument&&chrome.runtime.getContexts);
  const exists=async()=>supported()&&(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[documentURL]})).length>0;
  const message=(op,body={})=>chrome.runtime.sendMessage({target:'hermo.preview.offscreen',op,...body});
  const exclusive=work=>{const result=operations.catch(()=>{}).then(work);operations=result.catch(()=>{});return result;};
  async function closeDocument(){if(await exists())await chrome.offscreen.closeDocument().catch(()=>{});}
  async function dispose(capture){
    if(capture)await message('stop',{nonce:capture.nonce}).catch(()=>{});
    await closeDocument();
  }
  async function stop(session){
    if(session)failures.delete(session.id);else failures.clear();
    const ownsCapture=!session||active?.sessionId===session.id,ownsPending=!session||desired?.sessionId===session.id;
    if(!ownsCapture&&!ownsPending)return;
    if(ownsPending){++epoch;desired?.cancel();desired=undefined;}
    const previous=ownsCapture?active:undefined,shouldClose=ownsCapture||!active;
    if(ownsCapture)active=undefined;
    // A document left behind by a terminated MV3 worker must also be closed.
    // Resource operations serialize: a delayed stop can never close the
    // offscreen document belonging to a later explicit start.
    if(previous)void message('stop',{nonce:previous.nonce}).catch(()=>{});
    if(shouldClose)await exclusive(async()=>{
      // Another tab may have explicitly started sharing while this stop was
      // waiting for its turn. Its document must survive the older teardown.
      if(active&&active!==previous)return;
      await dispose(previous);
    });
  }
  async function ensureDocument(){
    if(await exists())return;
    if(!creation)creation=chrome.offscreen.createDocument({url:'preview-offscreen.html',reasons:['USER_MEDIA'],justification:'Show the explicitly authorized website tab inside local Hermo until stopped, idle, or expired.'}).finally(()=>{creation=undefined;});
    await creation;
  }
  async function status(session){
    if(!session||session.stopped||session.leaseExpiresAt<=now()){if(session&&active?.sessionId===session.id)await stop(session);return {state:'disabled'};}
    if(active?.sessionId!==session.id)return {state:failures.has(session.id)?'unavailable':'disabled'};
    if(active.expiresAt<=now()){await stop(session);return {state:'disabled'};}
    const capture=active;
    if(capture.state==='live'){
      try{
        const response=await message('status',{nonce:capture.nonce});if(active!==capture)return {state:'disabled'};
        if(!response?.ok){await stop(session);return {state:'disabled'};}
        if(['starting','unavailable'].includes(response.state))return {state:response.state};
      }catch{if(active===capture)await stop(session);return {state:'unavailable'};}
    }
    return {state:active===capture?capture.state:'disabled'};
  }
  async function start(session){
    if(!supported())throw Error('Live preview requires Chrome 120 or newer and the updated Hermo companion.');
    if(!session||session.stopped||session.leaseExpiresAt<=now())throw Error('Connect this website tab to Hermo before enabling live preview.');
    const tab=await chrome.tabs.get(session.tabId);
    if(!inScope(tab,session)||!tab.active)throw Error('Open the connected website tab, then enable live preview from its Hermo companion popup.');
    if(session.stopped||session.leaseExpiresAt<=now())throw Error('Preview stopped.');
    desired?.cancel();
    let cancel;const interrupted=new Promise((_,reject)=>{cancel=()=>reject(Error('Preview stopped.'));});void interrupted.catch(()=>{});
    const intent={sessionId:session.id,epoch:++epoch,cancel};desired=intent;
    return exclusive(async()=>{
      const valid=()=>desired===intent&&epoch===intent.epoch&&!session.stopped&&session.leaseExpiresAt>now();
      if(!valid())throw Error('Preview stopped.');
      let capture;
      try{
        const previous=active;active=undefined;await dispose(previous);
        if(!valid())throw Error('Preview stopped.');
        capture={sessionId:session.id,tabId:session.tabId,nonce:crypto.randomUUID(),expiresAt:Math.min(session.leaseExpiresAt,now()+PREVIEW_LEASE_MS),state:'starting'};
        active=capture;failures.delete(session.id);await ensureDocument();
        if(!valid())throw Error('Preview stopped.');
        // A service-worker-issued tab stream ID is consumable by an offscreen
        // document in Chrome 116+. No desktop chooser or unrelated tab is used.
        const streamId=await Promise.race([chrome.tabCapture.getMediaStreamId({targetTabId:session.tabId}),interrupted]);
        if(!valid())throw Error('Preview stopped.');
        const viewport=chrome.scripting?(await chrome.scripting.executeScript({target:{tabId:session.tabId},world:'ISOLATED',func:()=>({width:innerWidth,height:innerHeight})}))[0]?.result:undefined;
        if(viewport&&(!Number.isInteger(viewport.width)||!Number.isInteger(viewport.height)||viewport.width<1||viewport.height<1||viewport.width>8192||viewport.height>8192))throw Error('The website viewport is unavailable.');
        if(!valid())throw Error('Preview stopped.');
        const reply=await Promise.race([message('start',{streamId,nonce:capture.nonce,tabId:session.tabId,expiresAt:capture.expiresAt,idleMs:PREVIEW_IDLE_MS,...viewport?{viewport}:{}}),interrupted]);
        if(!valid())throw Error('Preview stopped.');
        if(!reply?.ok)throw Error('Chrome could not start this tab preview. Open the website and try Enable live preview again.');
        capture.state='live';return {state:'live',expires_at:capture.expiresAt};
      }catch(error){
        if(capture&&active===capture){failures.set(session.id,true);active=undefined;await dispose(capture);}
        else if(!active)await closeDocument();
        if(desired===intent)desired=undefined;
        throw error;
      }
    });
  }
  async function getFrame(session){
    const capture=active,state=await status(session);if(state.state!=='live')return state;
    if(!capture||active!==capture||capture.sessionId!==session.id)return {state:'disabled'};
    try{
      const tab=await chrome.tabs.get(session.tabId);if(active!==capture)return {state:'disabled'};
      if(!inScope(tab,session)){await stop(session);return {state:'disabled'};}
      const result=await message('frame',{nonce:capture.nonce});
      if(active!==capture||session.stopped||session.leaseExpiresAt<=now())return {state:'disabled'};
      if(!result?.ok){await stop(session);return {state:'unavailable'};}
      if(['starting','unavailable'].includes(result.state))return {state:result.state};
      if(typeof result.image!=='string'||result.image.length>PREVIEW_FRAME_LIMIT||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(result.image)||!Number.isInteger(result.width)||result.width<1||result.width>1600||!Number.isInteger(result.height)||result.height<1||result.height>1600||!Number.isFinite(result.captured_at)||now()-result.captured_at>PREVIEW_FRAME_FRESH_MS||result.captured_at-now()>1000){
        await stop(session);return {state:'unavailable'};
      }
      return {state:'live',image:result.image.slice('data:image/jpeg;base64,'.length),captured_at:result.captured_at,width:result.width,height:result.height};
    }catch{if(active===capture)await stop(session);return {state:'unavailable'};}
  }
  return {start,stop,status,getFrame,reset:()=>stop()};
}
