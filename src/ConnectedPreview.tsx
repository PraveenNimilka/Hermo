import {useEffect,useRef,useState} from 'react';
import {MessageSquare,Monitor} from 'lucide-react';
import {isConversationOutput,type ReadAttribute} from './ActionTypes';
type Item={id:string;label:string;kind:string;type?:string;value?:string;preview?:string;read_mode?:'last';semantic_role?:'user'|'assistant'|'identity'|'data'|'media';read_attribute?:ReadAttribute};
function assetLink(item:Item){if(!item.read_attribute||!['src','href','poster'].includes(item.read_attribute))return;try{const url=new URL(item.preview??'');if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{return;}}
export type PreviewState={state:'disabled'|'starting'|'live'|'unavailable'|'blocked'|'snapshot';captured_at?:number;width?:number;height?:number;interaction_id?:string};
export function ConnectedPreview({title,elements,image,preview,disabled=false,onPick,onScroll}:{title:string;elements:Item[];image?:string;preview?:PreviewState;disabled?:boolean;onPick?:(point:{frame_id:string;x:number;y:number})=>void;onScroll?:(point:{delta:number;x:number;y:number})=>void}){
  const[view,setView]=useState<'website'|'fields'>('website'),[now,setNow]=useState(Date.now());
  const surface=useRef<HTMLButtonElement>(null),scrollCallback=useRef(onScroll),scrollBlocked=useRef(true),liveRef=useRef(false),lastWheel=useRef(0);
  scrollCallback.current=onScroll;
  useEffect(()=>{setNow(Date.now());if(!image)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[image,preview?.captured_at]);
  const fresh=!!image&&!!preview?.captured_at&&now-preview.captured_at<5000;
  // Older companions may send an active-tab snapshot without freshness metadata.
  // It is never presented as a background live stream.
  const visible=!!image&&(fresh||!preview),live=fresh&&preview?.state==='live';
  const interactive=live&&!!preview?.interaction_id&&!!onPick;
  scrollBlocked.current=disabled||!live;
  liveRef.current=live;
  useEffect(()=>{
    const node=surface.current;if(!node)return;
    const wheel=(event:WheelEvent)=>{if(!liveRef.current||!scrollCallback.current||event.ctrlKey)return;event.preventDefault();event.stopPropagation();if(scrollBlocked.current||Date.now()-lastWheel.current<150)return;lastWheel.current=Date.now();const b=node.getBoundingClientRect(),factor=event.deltaMode===1?24:event.deltaMode===2?b.height:1;scrollCallback.current({delta:Math.max(-2000,Math.min(2000,Math.round(event.deltaY*factor))),x:Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))});};
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[visible,view]);
  const status=live?'Live website':visible?'Website snapshot':preview?.state==='starting'?'Starting preview':preview?.state==='blocked'?'Preview paused':'Preview off';
  return <section className="connected-visual" aria-label="Connected website preview">
    <div className="connected-preview-toolbar"><div className="segmented" role="group" aria-label="Preview view"><button type="button" aria-pressed={view==='website'} className={view==='website'?'active':''} onClick={()=>setView('website')}>Website</button><button type="button" aria-pressed={view==='fields'} className={view==='fields'?'active':''} onClick={()=>setView('fields')}>Detected fields</button></div><span className="preview-state" data-live={live}>{status}</span></div>
    {view==='fields'?<DetectedContent title={title} elements={elements}/>:visible?<figure className="connected-preview-frame"><button ref={surface} type="button" className="connected-preview-surface" aria-label="Interact with connected website" aria-disabled={disabled||!interactive} onClick={event=>{if(disabled||!interactive)return;if(event.detail===0){setView('fields');return;}const b=event.currentTarget.getBoundingClientRect();onPick?.({frame_id:preview!.interaction_id!,x:Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))});}}><img src={`data:image/jpeg;base64,${image}`} alt={`Website preview of ${title}`} draggable={false}/></button><figcaption>{interactive?'Click a button to operate it, or a field to edit its input. Scroll over the preview to scroll the website. Keyboard users can use the Interact controls and Scroll buttons.':live?'Actual tab appearance · enable a fresh preview with companion 0.7.3 to interact':'Captured website appearance · enable live preview for background updates'}</figcaption></figure>:<div className="connected-preview-empty"><Monitor size={28} aria-hidden="true"/><h3>{preview?.state==='blocked'?'Complete sign-in in Chrome':preview?.state==='starting'?'Preparing your website preview':'Show the actual website here'}</h3><p>{preview?.state==='blocked'?'Visual sharing pauses on sign-in, verification and restricted pages. Return to the authorized website when ready.':'On the connected website tab, open the Hermo companion and choose Enable live preview. Then return here.'}</p><p className="small-text muted">Only this authorized tab is shared. No audio is captured. Use the Interact controls to record steps.</p><a href="/connected-browser.html#live-preview" target="_blank" rel="noopener noreferrer">Live preview setup</a></div>}
  </section>;
}
function DetectedContent({title,elements}:{title:string;elements:Item[]}){
  const messages=elements.filter(item=>item.kind==='output'&&isConversationOutput(item));
  const fields=elements.filter(item=>item.kind==='output'&&!isConversationOutput(item)&&item.semantic_role!=='identity').slice(0,12);
  const draft=elements.find(item=>item.kind==='input'&&item.type==='editor')?.value;
  return <div className="browser-dom-preview connected-content"><header><Monitor size={18}/><strong>{title}</strong><span>Selected Chrome tab</span></header>
    {messages.length>0&&<div className="connected-messages">{[...messages].sort((a,b)=>Number(b.semantic_role==='user'||b.label==='Latest submitted message')-Number(a.semantic_role==='user'||a.label==='Latest submitted message')).map(item=><article className={item.semantic_role==='user'||item.label==='Latest submitted message'?'connected-message user':'connected-message assistant'} key={item.id}><strong>{item.semantic_role==='user'||item.label==='Latest submitted message'?'You':'Assistant'}</strong><p>{item.preview}</p></article>)}</div>}
    {fields.length>0&&<div className="connected-messages">{fields.map(item=><article className="connected-message data" key={item.id}>{item.label&&item.label!==item.preview&&!item.preview?.startsWith(item.label)&&<strong>{item.label}</strong>}{assetLink(item)?<a href={assetLink(item)} target="_blank" rel="noopener noreferrer">{item.preview}</a>:<p>{item.preview}</p>}</article>)}</div>}
    {!messages.length&&!fields.length&&<div className="connected-empty"><MessageSquare size={30}/><h3>Your website is ready</h3><p>Use the detected input and controls to demonstrate your task. Open the website tab to reveal any fields that are hidden.</p></div>}
    {draft&&<article className="connected-message user"><strong>Message draft</strong><p>{draft}</p></article>}
    <footer>Detected fields are a simplified inspection of the page. Choose Website to see its actual appearance.</footer>
  </div>;
}
