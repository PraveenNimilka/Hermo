import {extractOutputDocument} from './output-extraction.mjs';
import {readLegacyChatDocument} from './chat-messages.mjs';
import {readAccountIdentityDocument} from './account-identity.mjs';
import {diagnoseChatDocument} from './chat-diagnostics.mjs';
import {captureMediaDocument} from './media-capture.mjs';
import {previewDocument,scrollDocument} from './preview-interaction.mjs';
import {locatorProbeDocument} from './locator-probe.mjs';
// Serialized into Chrome's isolated extension world; no eval or remote code.
export function operateDocument(command){
  try{
  if(command.expires_at!==undefined&&Date.now()>=command.expires_at)throw Error('TIMEOUT');
  if(command.origin&&(location.origin!==command.origin||!location.pathname.startsWith(command.path_prefix)))throw Error('ORIGIN_CHANGED');
  const visible=element=>{const rect=element.getBoundingClientRect();return !!(rect.width&&rect.height&&getComputedStyle(element).visibility!=='hidden');};
  if([...document.querySelectorAll('input[type=password]')].some(visible)||/this browser or app may not be secure|verify (you are|you're) human|security verification/i.test(document.body?.innerText??''))throw Error('LOGIN_REQUIRED');
  function path(el){const root=el.getRootNode(),parts=[];let node=el;while(node&&node.nodeType===1){let anchor;for(const attribute of ['data-testid','aria-label','name','id']){const value=node.getAttribute(attribute);if(!value||value.length>200||attribute==='id'&&/^(radix-|:r|_r_)/.test(value))continue;const candidate=attribute==='id'?'#'+CSS.escape(value):`[${attribute}="${CSS.escape(value)}"]`;if(root.querySelectorAll(candidate).length===1){anchor=candidate;break;}}if(anchor){parts.unshift(anchor);break;}const tag=node.tagName.toLowerCase(),siblings=[...(node.parentNode?.children??[])].filter(value=>value.tagName===node.tagName);parts.unshift(tag+`:nth-of-type(${siblings.indexOf(node)+1})`);node=node.parentNode;if(parts.length>120)throw Error('ACTION_UNAVAILABLE');}const own=parts.join(' > ');return root.host?path(root.host)+' '+own:own;}
  const roots=[document];for(let index=0;index<roots.length&&index<80;index++)for(const element of roots[index].querySelectorAll('*'))if(!element.closest('[data-hermo-ui]')&&element.shadowRoot)roots.push(element.shadowRoot);
  const normalize=value=>(value??'').replace(/\s+/g,' ').trim();
  const associatedLabel=el=>[...(el.labels??[])].map(label=>{const copy=label.cloneNode(true);for(const control of copy.querySelectorAll('input,textarea,select,button'))control.remove();return copy.textContent;}).join(' ');
  const explicitName=el=>el.getAttribute('aria-label')||normalize((el.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>el.getRootNode().getElementById?.(id)?.textContent??'').join(' '))||associatedLabel(el);
  const name=el=>normalize(explicitName(el)||el.getAttribute('alt')||(['button','submit','reset'].includes(el.type)?el.value:'')||el.textContent);
  const role=el=>{
    const explicit=el.getAttribute('role')?.trim().split(/\s+/)[0];if(explicit)return explicit;
    const tag=el.tagName.toLowerCase();if(tag==='a'&&el.hasAttribute('href'))return 'link';if(tag==='button')return 'button';if(tag==='textarea'||el.isContentEditable)return 'textbox';
    if(tag==='input')return {checkbox:'checkbox',radio:'radio',range:'slider',number:'spinbutton',search:'searchbox',button:'button',submit:'button',reset:'button'}[el.type]??'textbox';
    if(tag==='select')return el.multiple||el.size>1?'listbox':'combobox';if(/^h[1-6]$/.test(tag))return 'heading';
    return {img:'img',table:'table',tr:'row',td:'cell',th:'columnheader',ul:'list',ol:'list',li:'listitem',nav:'navigation',main:'main',option:'option',progress:'progressbar',dialog:'dialog'}[tag];
  };
  const cssMatches=value=>{const values=[];for(const root of roots){let selector=value;if(root.host){let prefix;try{prefix=path(root.host)+' ';}catch{continue;}if(!selector.startsWith(prefix))continue;selector=selector.slice(prefix.length);}values.push(...[...root.querySelectorAll(selector)].filter(el=>!el.closest('[data-hermo-ui]')));}return values;};
  let matches=[];
  if(command.locators?.length){
    const rank={testId:0,role:1,label:2,css:3},choices=[...command.locators].sort((a,b)=>rank[a.kind]-rank[b.kind]);
    if(command.selector&&!choices.some(locator=>locator.kind==='css'&&locator.value===command.selector))choices.push({kind:'css',value:command.selector});
    for(const locator of choices){
      if(locator.kind==='css')matches=cssMatches(locator.value);
      else matches=roots.flatMap(root=>[...root.querySelectorAll('*')]).filter(el=>!el.closest('[data-hermo-ui]')&&(locator.kind==='testId'?el.getAttribute('data-testid')===locator.value:locator.kind==='role'?role(el)===locator.role&&name(el)===normalize(locator.name):locator.kind==='label'?normalize(explicitName(el))===normalize(locator.value):false));
      if(matches.length>1)throw Error('ELEMENT_AMBIGUOUS');
      if(matches.length)break;
    }
  }else matches=cssMatches(command.selector);
  const latest=command.op==='read'&&command.read_mode==='last';
  const candidates=latest?matches.filter(visible):matches;
  if(!latest&&candidates.length>1)throw Error('ELEMENT_AMBIGUOUS');
  if(command.op==='observe'){
    if(command.kind==='element'&&command.state==='hidden')return !candidates.length||!visible(candidates[0]);
    if(!candidates.length)return false;
    const target=candidates[0];if(target.matches('input[type=password],input[autocomplete=one-time-code],input[type=file]'))throw Error('ACTION_UNAVAILABLE');
    if(command.kind==='element')return visible(target)&&(command.state==='visible'||command.state==='enabled'&&!target.disabled&&target.getAttribute('aria-disabled')!=='true');
    if(command.kind==='text')return visible(target)&&(target.innerText??target.textContent??'').includes(command.text);
    throw Error('ACTION_UNAVAILABLE');
  }
  if(!candidates.length)throw Error('ACTION_UNAVAILABLE');const target=latest?candidates.at(-1):candidates[0];
  if(['ready','operate'].includes(command.op)){
    const semantics=(command.locators??[]).filter(locator=>['role','label'].includes(locator.kind));
    if(semantics.length&&!semantics.some(locator=>locator.kind==='role'?role(target)===locator.role&&name(target)===normalize(locator.name):normalize(explicitName(target))===normalize(locator.value)))throw Error('ELEMENT_CHANGED');
  }
  if(!visible(target)||target.disabled||target.getAttribute('aria-disabled')==='true'||target.matches('input[type=password],input[autocomplete=one-time-code],input[type=file]'))throw Error('ACTION_UNAVAILABLE');
  if(command.op==='ready')return true;
  if(command.op==='read'){
    const content=node=>{if(node.nodeType===3)return node.textContent;if(node.nodeType!==1||node.matches('[data-hermo-ui],[hidden],[aria-hidden="true"],.sr-only,.visually-hidden,button,[role="button"],time,script,style')||getComputedStyle(node).display==='none')return '';if(node.tagName==='BR')return '\n';const value=[...node.childNodes].map(content).join('');return /^(P|DIV|PRE|LI|UL|OL|TR|BLOCKQUOTE|SECTION|ARTICLE|H[1-6])$/.test(node.tagName)?'\n'+value+'\n':value;};
    const text=(latest?content(target).replace(/\n{3,}/g,'\n\n'):target.innerText??target.textContent??'').trim();if(text.length>4096)throw Error('ACTION_UNAVAILABLE');const identity=(()=>{const el=target;const key=Symbol.for('hermo.output.observations.v1'),registry=globalThis[key]??(globalThis[key]={nodes:new WeakMap(),next:0,document:crypto.randomUUID()});let id=registry.nodes.get(el);if(!id){id=++registry.next;registry.nodes.set(el,id);}return registry.document+':'+id;})();return command.details?{text,count:candidates.length,identity,streaming:[...document.querySelectorAll('button,[role=button]')].some(el=>!el.closest('[data-hermo-ui]')&&visible(el)&&/^stop$|stop (generating|streaming|response|generation)/i.test(el.getAttribute('aria-label')??el.textContent??''))||target.closest('[data-is-streaming="true"],[aria-busy="true"],[data-is-generating="true"]')!==null}:text;
  }
  if(command.expires_at!==undefined&&Date.now()>=command.expires_at)throw Error('TIMEOUT');
  if(command.preview_guard){
    const frame=globalThis[Symbol.for('hermo.preview.targets.v1')]?.get(command.preview_guard.frame_id),selected=frame?.targets.find(item=>item.id===command.preview_guard.target_id);
    const b=target.getBoundingClientRect(),hit=document.elementFromPoint(command.preview_guard.x*innerWidth,command.preview_guard.y*innerHeight);
    if(!frame||Date.now()-frame.at>5000||frame.view!==[location.href,innerWidth,innerHeight,scrollX,scrollY].join('|')||selected?.node!==target||selected.name!==(target.getAttribute('aria-label')??target.textContent?.slice(0,512)??'')||[b.x,b.y,b.width,b.height].some((value,index)=>Math.abs(value-selected.bounds[index])>2)||!(target===hit||target.contains(hit)))throw Error('ELEMENT_CHANGED');
  }
  if(command.completion_guard){
    // Compare selected marker text in this same synchronous isolated-world
    // operation, after readiness/authorization and immediately before input.
    for(const guard of command.completion_guard){
      const nodes=cssMatches(guard.selector).filter(visible);
      if(nodes.length>1||nodes.some(node=>node.matches('input,textarea,select,[contenteditable]')))throw Error('COMPLETION_CHANGED');
      const marker=nodes[0],observed=marker?(marker.innerText??marker.textContent??'').trim():null;
      if(observed!==guard.expected||marker?.closest('[aria-busy="true"],[data-is-streaming="true"],[data-is-generating="true"]'))throw Error('COMPLETION_CHANGED');
    }
  }
  const value=command.value;
  if(command.kind==='fill'){
    if(target.isContentEditable){
      target.focus();const range=document.createRange();range.selectNodeContents(target);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,value))throw Error('ACTION_UNAVAILABLE');
    }else{if(!target.matches('input,textarea'))throw Error('ACTION_UNAVAILABLE');const prototype=target.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,value);target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));}
    target.dispatchEvent(new Event('change',{bubbles:true}));
  }else if(command.kind==='select'){
    if(!target.matches('select')||![...target.options].some(option=>option.value===value&&!option.disabled))throw Error('ACTION_UNAVAILABLE');target.value=value;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));
  }else if(command.kind==='check'){
    if(!target.matches('input[type=checkbox],input[type=radio]')||!['true','false'].includes(value))throw Error('ACTION_UNAVAILABLE');if(target.checked!==(value==='true'))target.click();
  }else if(command.kind==='click'){
    if(!target.matches('button,a[href],[role=button],input[type=submit]'))throw Error('ACTION_UNAVAILABLE');
    if(target.href){const destination=new URL(target.href,location.href);if(destination.origin!==location.origin||!destination.pathname.startsWith(command.path_prefix))throw Error('ORIGIN_CHANGED');}target.click();
  }else throw Error('ACTION_UNAVAILABLE');return true;
  }catch(error){return {hermo_error:['LOGIN_REQUIRED','ORIGIN_CHANGED','TIMEOUT','ELEMENT_AMBIGUOUS','ELEMENT_CHANGED','COMPLETION_CHANGED'].includes(error.message)?error.message:'ACTION_UNAVAILABLE'};}
}

export async function executeBrowserCommand({chrome,tabId,origin,pathPrefix='/',command,inspect,signal,deadline,beforeMutation,getVisualFrame}){
  const check=()=>{if(signal?.aborted)throw Error('COMMAND_CANCELLED');if(deadline!==undefined&&Date.now()>=deadline)throw Error('TIMEOUT');};
  const pause=async duration=>{check();await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('COMMAND_CANCELLED'));},timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},duration);signal?.addEventListener('abort',abort,{once:true});});check();};
  const authorize=async()=>{check();await beforeMutation?.();check();};
  check();
  let tab;try{tab=await chrome.tabs.get(tabId);}catch{throw Error('TAB_CLOSED');}if(!tab?.url)throw Error('PERMISSION_REVOKED');
  if(new URL(tab.url).origin!==origin||!new URL(tab.url).pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');
  const script=async(func,args=[])=>{check();let results;try{results=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func,args});}catch(error){throw Error(/permission|cannot access|not allowed/i.test(error.message)?'PERMISSION_REVOKED':'PAGE_READ_FAILED');}check();if(results.length!==1||results[0].error||results[0].result===undefined)throw Error('PAGE_READ_FAILED');if(results[0].result?.hermo_error)throw Error(results[0].result.hermo_error);return results[0].result;};
  if(command.op==='capture_media')return script(captureMediaDocument,[{...command,origin,path_prefix:pathPrefix}]);
  if(command.op==='locator_probe'){
    return script(locatorProbeDocument,[{...command.payload,require_ready:true,origin,path_prefix:pathPrefix,expires_at:deadline}]);
  }
  if(command.op==='diagnose_chat'){
    const doc=await script(inspect,[{connected:true}]);if(command.public_source&&!doc.credentials)doc.login=false;if(doc.login||doc.credentials||doc.challenge||doc.authRejected||doc.denied||doc.networkError)throw Error('LOGIN_REQUIRED');
    return script(diagnoseChatDocument,[{...command,origin,path_prefix:pathPrefix}]);
  }
  if(command.op==='focus'){await chrome.tabs.update(tabId,{active:true});await chrome.windows.update(tab.windowId,{focused:true});return true;}
  if(command.op==='navigate'){
    const url=new URL(command.url);if(url.origin!==origin||url.username||url.password||!url.pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');await authorize();await chrome.tabs.update(tabId,{url:url.href});
  }else if(command.op==='reload'){await authorize();await chrome.tabs.reload(tabId);}
  else if(command.op==='scroll'){const doc=await script(inspect,[{connected:true}]);if(doc.credentials||doc.challenge||doc.authRejected||doc.denied||doc.networkError||doc.login&&!command.public_source)throw Error('LOGIN_REQUIRED');await authorize();await script(scrollDocument,[{delta:command.delta,...command.point}]);return true;}
  else if(command.op==='preview_pick'){
    const doc=await script(inspect,[{connected:true}]);if(doc.credentials||doc.challenge||doc.authRejected||doc.denied||doc.networkError||doc.login&&!command.public_source)throw Error('LOGIN_REQUIRED');
    return script(previewDocument,[{...command,op:'pick',origin,path_prefix:pathPrefix}]);
  }
  else if(command.op==='snapshot'){
    const doc=await script(inspect,[{connected:true}]);if(command.public_source&&!doc.credentials)doc.login=false;const safe=!doc.credentials&&!doc.login&&!doc.challenge&&!doc.authRejected&&!doc.denied&&!doc.networkError;
    if(safe&&!doc.elements.some(x=>x.read_mode==='last'&&x.semantic_role!=='media')){try{const messages=await script(readLegacyChatDocument,[{origin,path_prefix:pathPrefix}]);if(!Array.isArray(messages))throw Error('PAGE_READ_FAILED');doc.elements=[...doc.elements.filter(x=>x.kind!=='output'),...messages,...doc.elements.filter(x=>x.kind==='output')].slice(0,180);}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;}}
    if(!safe)doc.elements=[];else doc.elements=doc.elements.filter(item=>item.type!=='password');
    const current=await chrome.tabs.get(tabId);if(new URL(current.url).origin!==origin||!new URL(current.url).pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');
    const url=new URL(current.url);let image='',preview={state:safe?'disabled':'blocked'};
    // A user-approved tab stream keeps the exact website visible while the
    // dashboard is active. Never substitute a screenshot of the active tab.
    if(command.visual&&safe&&getVisualFrame){
      try{
        const frame=await getVisualFrame();check();
        if(frame&&['disabled','starting','live','unavailable'].includes(frame.state))preview={state:frame.state};
        if(frame?.state==='live'&&typeof frame.image==='string'&&frame.image.length<600000&&/^[A-Za-z0-9+/=]+$/.test(frame.image)&&Number.isFinite(frame.captured_at)&&Date.now()-frame.captured_at>=-1000&&Date.now()-frame.captured_at<5000&&Number.isInteger(frame.width)&&frame.width>0&&frame.width<=4096&&Number.isInteger(frame.height)&&frame.height>0&&frame.height<=4096){
          const after=await chrome.tabs.get(tabId),verified=await script(inspect,[{connected:true}]);
          if(command.public_source&&!verified.credentials)verified.login=false;
          if(after.url===current.url&&!verified.credentials&&!verified.login&&!verified.challenge&&!verified.authRejected&&!verified.denied&&!verified.networkError){image=frame.image;preview={state:'live',captured_at:frame.captured_at,width:frame.width,height:frame.height};}
          else preview={state:'blocked'};
        }else if(frame?.state==='live')preview={state:'unavailable'};
      }catch{check();preview={state:'unavailable'};}
    }
    if(image&&preview.state==='live'){
      const interaction_id=await script(previewDocument,[{op:'register',origin,path_prefix:pathPrefix,captured_at:preview.captured_at,width:preview.width,height:preview.height,elements:doc.elements}]);
      if(interaction_id)preview.interaction_id=interaction_id;
    }
    check();
    const final=await chrome.tabs.get(tabId);if(new URL(final.url).origin!==origin||!new URL(final.url).pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');
    if(final.url!==current.url){image='';preview={state:'unavailable'};}
    return {url:url.href,title:safe?(current.title??'Website').slice(0,300):'Sign in or verification required',doc,image,...command.visual?{preview}:{}};
  }else if(command.op==='extract'){
    const doc=await script(inspect,[{connected:true}]);if(command.public_source&&!doc.credentials)doc.login=false;if(doc.login||doc.credentials||doc.challenge||doc.authRejected||doc.denied||doc.networkError)throw Error('LOGIN_REQUIRED');
    return script(extractOutputDocument,[{mapping:command.mapping,origin,path_prefix:pathPrefix}]);
  }else if(command.op==='read'||command.op==='operate'||command.op==='observe'){
    const css=value=>typeof value==='string'&&value.length>0&&value.length<=3000&&!/[\u0000-\u001f\u007f]/.test(value)&&!/(?:>>|javascript\s*:|(?:^|\s)(?:xpath|text|id|data-testid|internal:[\w-]+)\s*=|:(?:has-text|text|text-is|text-matches|nth-match)\s*\(|=>|\b(?:eval|Function)\s*\()/i.test(value);
    const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=300&&!/[\u0000-\u001f\u007f]/.test(value);
    if(command.selector!==undefined&&!(command.op==='read'?typeof command.selector==='string'&&command.selector.length<=3000:css(command.selector))||command.locators!==undefined&&(!Array.isArray(command.locators)||!command.locators.length||command.locators.length>6||command.locators.some(locator=>!locator||!['testId','role','label','css'].includes(locator.kind)||(locator.kind==='css'?!css(locator.value):locator.kind==='role'?!text(locator.name)||typeof locator.role!=='string'||!/^[a-z]+$/.test(locator.role):!text(locator.value))))||command.op==='operate'&&!['fill','select','check','click'].includes(command.kind)||command.value!==undefined&&(typeof command.value!=='string'||command.value.length>4096)||command.timeout_ms!==undefined&&(!Number.isInteger(command.timeout_ms)||command.timeout_ms<100||command.timeout_ms>30000))throw Error('ACTION_UNAVAILABLE');
    const doc=await script(inspect,[{connected:true}]);if(command.public_source&&!doc.credentials)doc.login=false;if(doc.login||doc.credentials||doc.challenge||doc.authRejected||doc.denied||doc.networkError)throw Error('LOGIN_REQUIRED');
    if(command.op==='observe'){
      if(command.kind==='navigation'){
        if(!['domcontentloaded','load'].includes(command.state))throw Error('ACTION_UNAVAILABLE');
        const actual=new URL((await chrome.tabs.get(tabId)).url);
        if(command.url!==undefined){const target=new URL(command.url);if(target.origin!==origin||target.username||target.password||!target.pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');if(actual.href!==target.href)return false;}
        const state=await script(()=>document.readyState);
        return command.state==='domcontentloaded'?state!=='loading':state==='complete';
      }
      if(command.kind==='url'){
        const target=new URL(command.url),actual=new URL((await chrome.tabs.get(tabId)).url);
        if(target.origin!==origin||target.username||target.password||target.hash||!target.pathname.startsWith(pathPrefix)||actual.origin!==origin||!actual.pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');
        if(!['exact','contains'].includes(command.match??'exact'))throw Error('ACTION_UNAVAILABLE');
        return (command.match??'exact')==='exact'?actual.href===target.href:(actual.pathname+actual.search).includes(target.pathname+target.search);
      }
      if(!command.selector&&!command.locators?.length||command.kind==='element'&&!['visible','hidden','enabled'].includes(command.state)||command.kind==='text'&&(typeof command.text!=='string'||!command.text.trim()||command.text.length>2000)||!['element','text'].includes(command.kind))throw Error('ACTION_UNAVAILABLE');
      return script(operateDocument,[{...command,origin,path_prefix:pathPrefix,expires_at:deadline}]);
    }
    if(!command.selector&&!command.locators?.length)throw Error('ACTION_UNAVAILABLE');
    if(command.op==='operate'){
      if(command.completion_guard!==undefined&&(!Array.isArray(command.completion_guard)||!command.completion_guard.length||command.completion_guard.length>8||command.completion_guard.some(guard=>!guard||!css(guard.selector)||guard.expected!==null&&(typeof guard.expected!=='string'||guard.expected.length>4096))))throw Error('ACTION_UNAVAILABLE');
      // Wait only before the action. Never retry a click after it has been issued.
      const readyDeadline=Math.min(deadline??Infinity,Date.now()+(command.timeout_ms??5000));
      while(true){check();try{await script(operateDocument,[{...command,op:'ready',origin,path_prefix:pathPrefix,expires_at:deadline}]);break;}catch(error){if(error.message!=='ACTION_UNAVAILABLE'||Date.now()>=readyDeadline)throw error;await pause(150);}}
      const current=await chrome.tabs.get(tabId);if(new URL(current.url).origin!==origin||!new URL(current.url).pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');
      const ready=await script(inspect,[{connected:true}]);if(command.public_source&&!ready.credentials)ready.login=false;if(ready.login||ready.credentials||ready.challenge||ready.authRejected||ready.denied||ready.networkError)throw Error('LOGIN_REQUIRED');
      await authorize();
    }
    let result;
    const messageRole=command.op==='read'&&command.read_mode==='last'?['user','assistant'].find(role=>command.selector===':hermo-latest-'+role||['[data-message-author-role="'+role+'"]','[data-turn="'+role+'"]','[data-message-author-role="'+role+'"],[data-turn="'+role+'"]'].includes(command.selector)):undefined;
    if(command.op==='read'&&command.identity_text!==undefined){
      const identityDeadline=Date.now()+5000;
      while(true){try{result=await script(readAccountIdentityDocument,[{selector:command.selector,identity_text:command.identity_text,origin,path_prefix:pathPrefix}]);break;}catch(error){if(error.message!=='ACTION_UNAVAILABLE'||Date.now()>=identityDeadline)throw error;await pause(150);}}
    }
    else if(command.op==='read'&&command.read_attribute!==undefined){
      if(!['src','href','alt','download','poster'].includes(command.read_attribute))throw Error('ACTION_UNAVAILABLE');
      result=await script(inspect,[{connected:true,selector:command.selector,read_attribute:command.read_attribute,read_mode:command.read_mode,origin,path_prefix:pathPrefix}]);
      if(!command.details)result=result.text;
    }
    else if(command.op==='read'&&command.read_mode==='last'&&/^:hermo-heading-(user|assistant)$/.test(command.selector)){
      result=await script(inspect,[{connected:true,message_role:command.selector.slice(':hermo-heading-'.length)}]);
      if(!command.details)result=result.text;
    }
    else if(messageRole&&command.selector.startsWith(':hermo-latest-'))result=await script(readLegacyChatDocument,[{role:messageRole,origin,path_prefix:pathPrefix}]);
    else try{result=await script(operateDocument,[{...command,origin,path_prefix:pathPrefix,expires_at:deadline}]);}catch(error){if(!messageRole||error.message!=='ACTION_UNAVAILABLE')throw error;result=await script(readLegacyChatDocument,[{role:messageRole,origin,path_prefix:pathPrefix}]);}
    if(command.op==='read')return command.details||!messageRole?result:typeof result==='string'?result:result.text;
  }else throw Error('ACTION_UNAVAILABLE');
  for(let attempt=0;attempt<80;attempt++){await pause(100);const current=await chrome.tabs.get(tabId);if(new URL(current.url).origin!==origin||!new URL(current.url).pathname.startsWith(pathPrefix))throw Error('ORIGIN_CHANGED');if(current.status==='complete'&&(command.op!=='navigate'||current.url===command.url)){
    // Give the page's DOM and compositor time to paint before the next snapshot.
    await script(async()=>{await new Promise(done=>{const timer=setTimeout(done,180);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);done();}));});await new Promise(done=>setTimeout(done,100));return true;});return true;
  }}
  throw Error('TIMEOUT');
}
