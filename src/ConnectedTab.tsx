import {useEffect,useRef,useState} from 'react';
import {Copy,ExternalLink,Link2,Loader2} from 'lucide-react';
type Request=(path:string,body?:unknown)=>Promise<any>;
export function ConnectedTab({connectionId,request,onConnected,initiallyOpen=false}:{connectionId:string;request:Request;onConnected:(confirmed:boolean)=>Promise<void>;initiallyOpen?:boolean}){
  const[authorized,setAuthorized]=useState(false),[grant,setGrant]=useState<any>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[info,setInfo]=useState<any>(),[browsers,setBrowsers]=useState<{id:string;name:string}[]>([]),[browser,setBrowser]=useState('');
  const[recoveryAuthorized,setRecoveryAuthorized]=useState(false);
  const[setupOpen,setSetupOpen]=useState(initiallyOpen);
  const[recoveryOpen,setRecoveryOpen]=useState(false);
  useEffect(()=>{if(initiallyOpen||grant)setSetupOpen(true);},[initiallyOpen,grant]);
  useEffect(()=>{if(info?.pairing_error){setSetupOpen(true);setRecoveryOpen(true);setMessage(info.pairing_error.message);}},[info?.pairing_error?.message]);
  useEffect(()=>{request(`/studio/connections/${connectionId}/browser-link`).then(v=>{setInfo(v);setBrowser(v.browser_workspace_id??'');}).catch(()=>{});request('/studio/browser-workspaces').then(v=>setBrowsers(v.browsers)).catch(()=>{});},[connectionId]);
  const connectedCallback=useRef(onConnected);connectedCallback.current=onConnected;
  useEffect(()=>{
    if(!grant)return;
    let cancelled=false,checking=false,finished=false;const ticket=grant.code;
    const check=async()=>{if(checking||cancelled||finished)return;if(Date.parse(grant.expires_at)<=Date.now()){finished=true;setMessage('Connect code expired. Create a new code to connect this tab.');return;}checking=true;try{
      const value=await request(`/studio/connections/${connectionId}/browser-link`);
      if(cancelled)return;setInfo(value);
      if(value.pairing_error){finished=true;setGrant((current:any)=>current?.code===ticket?null:current);setMessage(value.pairing_error.message);setRecoveryOpen(true);return;}
      if(value.linked&&value.confirmed&&!value.pairing_pending){await connectedCallback.current(true);finished=true;if(cancelled)return;setGrant((current:any)=>current?.code===ticket?null:current);setMessage('Website tab connected. Keep it open while using Hermo.');}
    }catch(error){if(!cancelled)setMessage(error instanceof Error?error.message:'Could not open the connected tab.');}finally{checking=false;}};
    const timer=setInterval(()=>void check(),1500);void check();
    return()=>{cancelled=true;clearInterval(timer);};
  },[connectionId,grant,request]);
  return <details className="advanced connected-tab-setup" open={setupOpen} onToggle={event=>setSetupOpen(event.currentTarget.open)}><summary>Connect your website tab</summary><p>Keep your existing website session. This connects one tab in normal Chrome through a local companion; no cookie import or separate service subscription is required.</p>
    <p className="small-text">If already installed, reload <strong>Hermo · connect this browser tab</strong> in <code>chrome://extensions</code>. Keep the same extension folder when updating to preserve its browser identity.</p>
    {info&&<div className="card-actions">{info.browser_kind==='managed'?<button type="button" className="button secondary" onClick={async()=>{try{await request(`/studio/browser-workspaces/${info.browser_workspace_id}/open`,{connection_id:connectionId});setMessage('Website opened. Click its Hermo companion.');}catch(e){setMessage(e instanceof Error?e.message:'Could not open Chrome.');}}}>Open website in saved browser</button>:<a className="button secondary" href={info.website_url} target="_blank" rel="noopener noreferrer">Open website <ExternalLink size={14}/></a>}</div>}
    <form onSubmit={async event=>{event.preventDefault();setBusy(true);setMessage('');try{setGrant(await request(`/studio/connections/${connectionId}/browser-link`,{authorized}));}catch(error){setMessage(error instanceof Error?error.message:'Could not create a pairing code.');}finally{setBusy(false);}}}>

      <label className="checkbox-row"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)} required/><span>I authorize Hermo to read this website tab and replay the workflows I record. Runs use the account currently signed in to this tab. Website actions may submit forms. I will sign in and complete verification directly in Chrome.</span></label>
      <button className="button secondary" disabled={busy||!authorized}>{busy?<Loader2 size={16} className="spin"/>:<Link2 size={16}/>}<span>Create Connect code</span></button>
    </form>
    {grant&&<div className="normal-chrome-grant"><p>In Chrome, sign in normally to <strong>{grant.website_origin}</strong>, then open the <strong>Hermo · connect this browser tab</strong> extension on that website tab.</p><p className="small-text">Load this separate companion once from <code>{grant.extension_directory}</code> using <code>chrome://extensions</code> → Developer mode → Load unpacked.</p><label className="field"><span>Connect code · expires {new Date(grant.expires_at).toLocaleTimeString()}</span><input readOnly type="password" autoComplete="off" value={grant.code}/></label><button className="button ghost" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(grant.code);setMessage('Connect code copied. Paste it into the companion popup, then press Enter.');}catch{setMessage('Select the code field and copy it manually.');}}}><Copy size={16}/><span>Copy Connect code</span></button><p className="small-text">Enter this workspace address in the companion: <code>{grant.workspace_origin}</code>. Close the popup after connecting. Keep the website tab open; its Hermo panel shows the connection and Stop button.</p></div>}
    <div className="card-actions"><button className="button secondary" type="button" disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{const value=await request(`/studio/connections/${connectionId}/browser-link`);if(!value.linked)throw Error('No tab is linked yet. Pair the already signed-in website tab using the local companion.');if(grant&&value.pairing_pending)throw Error('Paste this Connect code into the website companion first.');await onConnected(value.confirmed);setGrant(null);setInfo(value);setMessage('Website tab connected. Keep it open while using Hermo.');}catch(error){setMessage(error instanceof Error?error.message:'Could not check the connection.');}finally{setBusy(false);}}}>Check tab connection</button><a className="text-button" href="/connected-browser.html" target="_blank" rel="noopener noreferrer">Installation and usage <ExternalLink size={14}/></a></div>
    {info?.browser_workspace_id&&<details className="advanced" open={recoveryOpen} onToggle={event=>setRecoveryOpen(event.currentTarget.open)}><summary>Reconnect after reinstalling the companion</summary>
      <p className="small-text">Use this if the companion says this app belongs to another saved browser. Loading the extension from a new folder, reinstalling it, or changing Chrome profiles creates a different companion identity.</p>
      <p className="small-text">This stops every website connection in <strong>{browsers.find(b=>b.id===info.browser_workspace_id)?.name??'this saved browser'}</strong> and clears its old browser binding. Saved actions, published versions, API keys and website sign-ins remain. Active runs or recordings must finish first. Each website needs a fresh Connect code afterward.</p>
      <label className="checkbox-row"><input type="checkbox" checked={recoveryAuthorized} disabled={busy} onChange={event=>setRecoveryAuthorized(event.target.checked)}/><span>I authorize reconnecting this saved browser and stopping its existing website connections.</span></label>
      <button type="button" className="button secondary" disabled={busy||!authorized||!recoveryAuthorized} onClick={async()=>{
        setBusy(true);setMessage('');setGrant(null);
        try{
          await request(`/studio/browser-workspaces/${info.browser_workspace_id}/reset-context`,{authorized:true});
          setInfo(await request(`/studio/connections/${connectionId}/browser-link`));
          setGrant(await request(`/studio/connections/${connectionId}/browser-link`,{authorized:true}));
          setRecoveryAuthorized(false);setMessage('Old browser binding cleared. Copy the new Connect code and connect the intended website tab. Other saved apps need their own new codes.');
        }catch(error){setMessage(error instanceof Error?error.message:'Could not reconnect this saved browser.');}finally{setBusy(false);}
      }}>Reset browser binding and create code</button>
    </details>}
    {info?.mode==='connected'&&browsers.length>1&&<details className="advanced"><summary>Change saved browser</summary><label className="field"><span>Use this browser</span><select value={browser} onChange={e=>setBrowser(e.target.value)}>{browsers.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button type="button" className="button secondary" disabled={busy||browser===info.browser_workspace_id} onClick={async()=>{setBusy(true);try{await request(`/studio/connections/${connectionId}/browser-workspace`,{browser_workspace_id:browser,authorized:true});setInfo(await request(`/studio/connections/${connectionId}/browser-link`));setGrant(null);setMessage('Saved browser changed. Create a new Connect code and connect the website there.');}catch(e){setMessage(e instanceof Error?e.message:'Could not change browser.');}finally{setBusy(false);}}}>Use this saved browser</button></details>}
    {message&&<p className="small-text" role="status">{message}</p>}
  </details>;
}
