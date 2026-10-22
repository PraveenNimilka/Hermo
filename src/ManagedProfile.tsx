import {useEffect,useId,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {LoaderCircle} from 'lucide-react';
import './managed-profile.css';

type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
type Visibility='headless'|'visible';
type Profile={
  connection_id:string;name:string;storage:'encrypted_profile';session_saved:boolean;
  identity_verified:boolean;visibility:Visibility;available:boolean;busy:boolean;
  capabilities:{persistent_profile_directory:boolean;network_policy:'workflow_defined'};
  browser:{available:boolean;source:'configured'|'bundled'|'system'|'missing'};
};
type Props={connectionId:string;request:Request;onChanged?:()=>Promise<void>|void};

export function ManagedProfile({connectionId,request,onChanged}:Props){
  const [profile,setProfile]=useState<Profile|null>(null),[visibility,setVisibility]=useState<Visibility>('headless');
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[resetting,setResetting]=useState(false);
  const [error,setError]=useState(''),[resetError,setResetError]=useState(''),[notice,setNotice]=useState('');
  const [resetOpen,setResetOpen]=useState(false),[confirmation,setConfirmation]=useState('');
  const requestRef=useRef(request),changedRef=useRef(onChanged),connectionRef=useRef(connectionId);
  const generation=useRef(0),scope=useRef(0),mounted=useRef(false),operation=useRef(false),cancelRef=useRef<HTMLButtonElement>(null);
  const id=useId(),visibilityId=`${id}-visibility`,helpId=`${id}-visibility-help`,resetId=`${id}-reset`,resetHelpId=`${id}-reset-help`,resetErrorId=`${id}-reset-error`;
  requestRef.current=request;changedRef.current=onChanged;connectionRef.current=connectionId;
  const current=profile?.connection_id===connectionId?profile:null;
  const busy=loading||saving||resetting||current?.busy===true;
  const phrase=`Reset "${current?.name??''}"`;
  const path=`/studio/connections/${encodeURIComponent(connectionId)}/managed-profile`;
  const active=(connection:string,ticket:number)=>mounted.current&&connectionRef.current===connection&&generation.current===ticket;

  async function load(connection:string,endpoint:string){
    const ticket=++generation.current;
    setLoading(true);setError('');
    try{
      const value=await requestRef.current<Profile>(endpoint);
      if(!active(connection,ticket))return;
      if(value.connection_id!==connection)throw new Error('The browser settings did not match this connection. Refresh and try again.');
      setProfile(value);setVisibility(value.visibility);
    }catch(cause){if(active(connection,ticket))setError(message(cause));}
    finally{if(active(connection,ticket))setLoading(false);}
  }
  useEffect(()=>{
    mounted.current=true;scope.current++;operation.current=false;
    setProfile(null);setResetOpen(false);setConfirmation('');setResetError('');setNotice('');setSaving(false);setResetting(false);
    void load(connectionId,path);
    return()=>{mounted.current=false;generation.current++;scope.current++;};
  },[connectionId]);

  async function change(kind:'save'|'reset'){
    if(!current||busy||operation.current||kind==='reset'&&confirmation!==phrase)return;
    const connection=connectionId,endpoint=path,ticket=++generation.current,operationScope=scope.current;
    const sameScope=()=>mounted.current&&connectionRef.current===connection&&scope.current===operationScope;
    operation.current=true;setError('');setResetError('');setNotice('');
    if(kind==='reset')setResetting(true);else setSaving(true);
    try{
      await requestRef.current(kind==='reset'?`${endpoint}/reset`:endpoint,kind==='reset'?{confirmation}:{visibility});
      if(!active(connection,ticket))return;
      setResetOpen(false);setConfirmation('');
      setNotice(kind==='reset'?'Saved browser session reset. Sign in again, confirm the account and verify affected workflows before publishing.':'Browser visibility saved. It applies to the next browser session.');
      await load(connection,endpoint);
      if(sameScope()){
        try{await changedRef.current?.();}catch{if(sameScope())setError('The browser settings changed, but the connection list could not refresh. Refresh the page to update it.');}
      }
    }catch(cause){if(active(connection,ticket)){if(kind==='reset')setResetError(message(cause));else setError(message(cause));}}
    finally{if(sameScope()){operation.current=false;setSaving(false);setResetting(false);}}
  }

  return <details className="managed-profile">
    <summary>Managed browser</summary>
    <div className="managed-profile-body" aria-busy={loading||saving||resetting}>
      <div className="managed-profile-heading"><h3>Browser session</h3><button type="button" className="button ghost" disabled={loading||saving||resetting} onClick={()=>void load(connectionId,path)}>Refresh status</button></div>
      {loading&&<p role="status" className="managed-profile-progress"><LoaderCircle size={16} className="spin" aria-hidden="true"/>Loading browser settings…</p>}
      {error&&<p className="notice error" role="alert">{error}</p>}
      {notice&&<p className="notice" role="status">{notice}</p>}
      {!loading&&!current&&<p>Browser settings are unavailable. Use Refresh status to try again.</p>}
      {current&&<>
        <dl className="managed-profile-status"><div><dt>Browser</dt><dd>{current.browser.available?current.browser.source==='configured'?'Configured browser ready':current.browser.source==='system'?'System browser ready':'Bundled browser ready':'Browser installation missing'}</dd></div><div><dt>Saved session</dt><dd>{current.session_saved?'Encrypted session saved':'No session saved'}</dd></div><div><dt>Account check</dt><dd>{current.identity_verified?'Account confirmed':'Confirmation needed'}</dd></div><div><dt>Availability</dt><dd>{current.busy?'In use · settings are locked':current.available?'Ready':'Unavailable'}</dd></div></dl>
        {!current.browser.available&&<div className="managed-profile-install"><p>Install Chromium on the computer running Hermo:</p><code>npx playwright install chromium</code><p>Or configure <code>HERMO_BROWSER_PATH</code> with the path to a supported browser executable, then restart the runtime.</p></div>}
        <p>Hermo keeps a dedicated Chromium profile for this connection, encrypted between browser sessions. Temporary readable browser files exist while it runs. Personal Chrome profiles are never imported.</p>
        <p>Retrieval workflows allow GET and HEAD requests only. Workflows configured for website actions can submit requests and use secure sockets within their reviewed website origins.</p>
        <div className="managed-profile-settings"><label htmlFor={visibilityId}>Execution visibility</label><select id={visibilityId} value={visibility} disabled={busy} aria-describedby={helpId} onChange={event=>setVisibility(event.target.value as Visibility)}><option value="headless">Run in the background</option><option value="visible">Show the browser window</option></select><p id={helpId}>Choose whether the managed browser window is visible. Changes apply when its next session starts.{current.busy?' Wait for the current browser session to finish before changing settings.':''}</p></div>
        <div className="managed-profile-actions"><button type="button" className="button secondary" disabled={busy||visibility===current.visibility} onClick={()=>void change('save')}>{saving&&<LoaderCircle size={16} className="spin" aria-hidden="true"/>}{saving?'Saving…':'Save browser settings'}</button></div>
        <Dialog.Root open={resetOpen} onOpenChange={value=>{if(!resetting){setResetOpen(value);setResetError('');setConfirmation('');}}}>
          <div className="managed-profile-reset"><div><h4>Reset saved session</h4><p>Remove the saved login and account confirmation for this connection.</p></div><Dialog.Trigger asChild><button type="button" className="button ghost" disabled={busy}>Reset saved session…</button></Dialog.Trigger></div>
          <Dialog.Portal><Dialog.Overlay className="dialog-overlay managed-profile-overlay"/><Dialog.Content role="alertdialog" className="dialog-content managed-profile-dialog" onOpenAutoFocus={event=>{event.preventDefault();cancelRef.current?.focus();}} onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(resetting)event.preventDefault();}}>
            <div className="dialog-heading"><div><Dialog.Title>Reset this saved browser session?</Dialog.Title><Dialog.Description>Remove the saved login for {current.name}.</Dialog.Description></div></div>
            <div className="dialog-body"><p>The saved cookies, local storage, IndexedDB and account confirmation will be cleared. Affected workflows will need account confirmation and a new verification. Existing API keys will be revoked; workflow IDs are preserved.</p><div className="managed-profile-settings"><label htmlFor={resetId}>Type <strong>{phrase}</strong> to confirm</label><input id={resetId} value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={resetting} required autoComplete="off" spellCheck={false} aria-describedby={`${resetHelpId}${resetError?' '+resetErrorId:''}`} aria-invalid={resetError?true:undefined}/><p id={resetHelpId}>The text must match exactly, including quotation marks.</p></div>{resetError&&<p id={resetErrorId} className="notice error" role="alert">{resetError}</p>}<div className="dialog-footer"><Dialog.Close asChild><button type="button" ref={cancelRef} className="button secondary" disabled={resetting}>Cancel</button></Dialog.Close><button type="button" className="button danger" disabled={resetting||confirmation!==phrase||current.busy} aria-busy={resetting} onClick={()=>void change('reset')}>{resetting&&<LoaderCircle size={16} className="spin" aria-hidden="true"/>}{resetting?'Resetting session…':'Reset saved session'}</button></div></div>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
      </>}
    </div>
  </details>;
}

const message=(cause:unknown)=>cause instanceof Error?cause.message:'The browser settings could not be loaded or changed. Refresh status and try again.';
