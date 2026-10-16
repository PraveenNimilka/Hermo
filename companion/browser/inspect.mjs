// Executed only inside the isolated website document.
export function inspectDocument(target) {
  function selector(el) {
    const root=el.getRootNode();let own;
    const parts=[];let node=el;
    while(node&&node.nodeType===1){
      let anchor;for(const attribute of ['data-testid','aria-label','name','id']){const value=node.getAttribute(attribute);if(!value||value.length>200||attribute==='id'&&/^(radix-|:r|_r_)/.test(value))continue;const candidate=attribute==='id'?'#'+CSS.escape(value):`[${attribute}="${CSS.escape(value)}"]`;if(root.querySelectorAll(candidate).length===1){anchor=candidate;break;}}
      if(anchor){parts.unshift(anchor);break;}
      const tag=node.tagName.toLowerCase(),siblings=[...(node.parentNode?.children??[])].filter(n=>n.tagName===node.tagName);parts.unshift(tag+`:nth-of-type(${siblings.indexOf(node)+1})`);node=node.parentNode;
      if(parts.length>120)throw new Error('DOM_DEPTH_LIMIT');
    }
    own=parts.join(' > ');
    return root.host?selector(root.host)+' '+own:own;
  }
  if(target?.nodeType===1)return selector(target);
  const safeSelector=el=>{try{const value=selector(el);return value.length<=3000?value:null;}catch{return null;}};
  const excluded='[data-hermo-ui],[hidden],[aria-hidden="true"],.sr-only,.visually-hidden,script,style';
  const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest(excluded);};
  const roots=[document],nodes=[];
  for(let i=0;i<roots.length&&i<80;i++)for(const el of roots[i].querySelectorAll('*')){if(el.closest('[data-hermo-ui]'))continue;if(nodes.length>=15000)break;nodes.push(el);if(el.shadowRoot)roots.push(el.shadowRoot);}
  const labelText=el=>{const copy=el.labels?.[0]?.cloneNode(true);if(!copy)return '';for(const child of copy.querySelectorAll('input,textarea,select,button'))child.remove();return copy.textContent?.trim();};
  const editor=el=>el.isContentEditable&&(el.hasAttribute('contenteditable')||el.getAttribute('role')==='textbox');
  const label=el=>el.getAttribute('aria-label')||(el.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>el.getRootNode().getElementById?.(id)?.textContent??'').join(' ').trim()||labelText(el)||el.getAttribute('placeholder')||el.getAttribute('data-placeholder')||el.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')||(editor(el)?'Message':el.tagName==='SELECT'?(el.getAttribute('title')||'Choose an option'):el.textContent)||el.getAttribute('title')||el.getAttribute('name')||el.tagName.toLowerCase();
  const text=el=>(el.innerText??el.textContent??'').trim();
  // Media is read from a user-selected rendered element. Never fetch an asset,
  // serialize pixels, or turn page-local blob/data addresses into public URLs.
  const mediaAttributes=new Set(['src','href','alt','download','poster']);
  const assetValue=(el,attribute)=>{
    if(!mediaAttributes.has(attribute))return '';
    if(attribute==='alt'||attribute==='download')return (el.getAttribute(attribute)??'').trim().slice(0,4096);
    const raw=attribute==='src'?(el.currentSrc||el.getAttribute('src')||el.querySelector('source[src]')?.getAttribute('src')):el.getAttribute(attribute);
    if(!raw)return '';
    try{const url=new URL(raw,location.href);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&url.href.length<=4096?url.href:'';}catch{return '';}
  };
  const mediaPending=el=>el.matches('img')&&(!el.complete||el.naturalWidth===0)||el.matches('video,audio')&&el.readyState<1||!!el.closest('[aria-busy="true"],[data-is-generating="true"],[data-is-streaming="true"]');
  const resultMedia=el=>!el.closest('nav,header,aside,[role="navigation"],[data-hermo-ui]')&&!/(?:avatar|profile|account|logo|icon)/i.test(['id','class','data-testid'].map(name=>el.getAttribute(name)??'').join(' '))&&(!el.matches('img')||el.getBoundingClientRect().width>=32&&el.getBoundingClientRect().height>=32);
  const generating=()=>nodes.some(el=>visible(el)&&el.matches('button,[role="button"]')&&/^stop$|stop (generating|streaming|response|generation)/i.test(label(el)));
  if(target?.read_attribute){
    if(target.origin&&(location.origin!==target.origin||!location.pathname.startsWith(target.path_prefix??'/')))return {hermo_error:'ORIGIN_CHANGED'};
    if(!mediaAttributes.has(target.read_attribute)||typeof target.selector!=='string')return {hermo_error:'ACTION_UNAVAILABLE'};
    const matches=[];
    for(const root of roots){let query=target.selector;if(root.host){const prefix=safeSelector(root.host)+' ';if(!query.startsWith(prefix))continue;query=query.slice(prefix.length);}try{matches.push(...root.querySelectorAll(query));}catch{return {hermo_error:'ACTION_UNAVAILABLE'};}}
    const candidates=matches.filter(el=>visible(el)&&(target.read_mode!=='last'||!['src','poster','alt'].includes(target.read_attribute)||resultMedia(el))),el=target.read_mode==='last'?candidates.at(-1):candidates.length===1?candidates[0]:undefined;
    if(!el)return {hermo_error:'ACTION_UNAVAILABLE'};
    const value=assetValue(el,target.read_attribute);
    return {text:value,count:candidates.length,streaming:mediaPending(el)||generating()};
  }
  const messageText=el=>{
    const omit=excluded+',button,[role="button"],time';
    const walk=node=>{
      if(node.nodeType===3)return node.textContent;
      if(node.nodeType!==1||node.matches(omit)||getComputedStyle(node).display==='none')return '';
      if(node.tagName==='BR')return '\n';
      const value=[...node.childNodes].map(walk).join('');
      return /^(P|DIV|PRE|LI|UL|OL|TR|BLOCKQUOTE|SECTION|ARTICLE|H[1-6])$/.test(node.tagName)?'\n'+value+'\n':value;
    };
    return walk(el).replace(/\n{3,}/g,'\n\n').trim();
  };
  const noise=value=>!value||/^(?:use the (?:up|left|arrow)|press (?:enter|escape)|you said:|(?:claude|chatgpt|assistant) responded:|\d+ (?:seconds?|minutes?|hours?|days?) ago\b)/i.test(value);
  const conversation='[aria-label="Conversation"],[data-message-author-role],[data-turn],[data-testid="user-message"],[data-testid="assistant-message"]';
  // Role evidence comes from message attributes or explicit speaker headings,
  // never the content of a message. Heading reads rediscover every turn.
  const headings=[];
  for(const heading of nodes.filter(el=>el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]'))){
    const value=(heading.textContent??'').trim(),role=/^(?:you said|you|user):?$/i.test(value)?'user':/^(?:claude responded|chatgpt said|assistant said|assistant|claude):?$/i.test(value)?'assistant':undefined;
    if(!role)continue;
    let content=heading.nextElementSibling;
    if(!content||!visible(content)||content.matches('input,textarea,[contenteditable],button')||content.querySelector('input,textarea,[contenteditable]'))continue;
    while(content.children.length===1&&visible(content.children[0])&&content.children[0].tagName==='DIV')content=content.children[0];
    const message=messageText(content);if(message&&message.length<=4096)headings.push({role,content});
  }
  if(!headings.some(item=>item.role==='user')||!headings.some(item=>item.role==='assistant'))headings.length=0;
  const messageNodes=new Set(headings.map(item=>item.content));
  const inMessage=el=>!!el.closest(conversation)||[...messageNodes].some(node=>node.contains(el)||el.contains(node));
  const identityEligible=(el,content)=>{
    if(inMessage(el)||el.closest('form,[contenteditable],input,textarea')||content.length>160||noise(content)||/\n/.test(content))return false;
    if(/^(new chat|chatgpt|chat|work|scheduled|library|plugins|explore|projects|no projects|recents|plus|upgrade|sign in|log in|sign out|log out|settings|search|temporary chat|ready when you are\.?|response complete)$/i.test(content))return false;
    if(/^(?:manage|view|edit|open|upgrade|switch|billing|subscription|help|delete|remove)\b/i.test(content)||/^(free|pro|team|enterprise|account|profile)$/i.test(content))return false;
    let scope=el,strong=false;
    for(let depth=0;scope&&depth<8;depth++,scope=scope.parentElement){
      if(scope.matches('main,body,html'))break;
      const context=['id','data-testid','aria-label','class'].map(name=>scope.getAttribute(name)??'').join(' ');
      if(/(?:^|[\s_-])(?:profile|account|user-menu|user-name|username|avatar)(?:$|[\s_-])/i.test(context))strong=true;
      if(/sidebar/i.test(context)&&/\b(?:account|owner)\b/i.test(content)&&content.length<=80&&!/[.!?]/.test(content))strong=true;
      if(scope.matches('aside,[role="complementary"]')&&/^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,4}$/u.test(content)&&!el.closest('a[href]'))strong=true;
    }
    return strong&&!el.closest('a[href]')||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)&&!!el.closest('aside,[role="menu"],[role="dialog"]');
  };
  if(target?.message_role){
    const matches=headings.filter(item=>item.role===target.message_role),last=matches.at(-1);
    if(!last)return {hermo_error:'ACTION_UNAVAILABLE'};
    return {text:messageText(last.content),count:matches.length,streaming:!!last.content.closest('[data-is-streaming="true"],[aria-busy="true"]')||nodes.some(el=>visible(el)&&el.matches('button,[role="button"]')&&/^stop$|stop (generating|streaming|response)/i.test(label(el)))};
  }
  const values=[];
  const secondaryControl=el=>{
    if(el.matches('input,textarea,select')||editor(el)||el.getAttribute('role')==='textbox')return false;
    const name=label(el).trim();
    if(el.closest('nav,[role="navigation"],header,aside,[role="complementary"]'))return true;
    return /^(?:copy(?: message| response)?|good response|bad response|like|dislike|thumbs up|thumbs down|read aloud|read out loud|regenerate|retry|share|edit message)(?: response| message)?$/i.test(name)||inMessage(el)&&!/^send(?: message)?$|^submit$/i.test(name);
  };
  // Input surfaces come first so a long navigation/sidebar cannot hide them.
  const inputs=nodes.filter(el=>el.matches('input,textarea,select')||editor(el)),other=nodes.filter(el=>el.matches('button,a[href],[role="button"],[role="checkbox"],[role="radio"],[role="textbox"]')&&!el.matches('input,textarea,select')&&!editor(el));
  const ordered=[...inputs,...other.filter(el=>!secondaryControl(el)),...other.filter(secondaryControl)];
  for(const el of ordered){
    if(values.length>=100)break;if(!visible(el))continue;
    const tag=el.tagName.toLowerCase(),role=el.getAttribute('role'),type=el.getAttribute('type')??'text';let kind;
    if(tag==='select')kind='select';
    else if(tag==='input'&&type==='submit')kind='button';
    else if(type==='checkbox'||type==='radio'||role==='checkbox'||role==='radio')kind='check';
    else if(['input','textarea'].includes(tag)||editor(el)||role==='textbox')kind='input';
    else if(tag==='button'||tag==='a'&&el.hasAttribute('href')||role==='button')kind='button';
    if(!kind||['hidden','file','range','color','submit','reset'].includes(type)&&kind==='input')continue;
    const path=safeSelector(el);if(!path)continue;
    const item={kind,selector:path,label:label(el).trim().slice(0,100),type:editor(el)?'editor':type.slice(0,100),disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true',secondary:secondaryControl(el)};
    if(editor(el))item.value=(el.innerText??el.textContent??'').slice(0,1000);
    if(kind==='check'){item.checked=!!el.checked||el.getAttribute('aria-checked')==='true';item.type=type==='radio'||role==='radio'?'radio':'checkbox';}
    if(kind==='select'){item.options=[...el.options].slice(0,100).map(o=>({value:o.value,label:o.textContent?.trim().slice(0,100),disabled:o.disabled}));item.value=el.value;}
    values.push(item);
  }
  if(target?.connected){
    for(const [role,name]of [['assistant','Latest assistant response'],['user','Latest submitted message']]){
      let detected=false;
      for(const root of roots){const query=['[data-message-author-role="'+role+'"]','[data-turn="'+role+'"]','[data-testid="'+role+'-message"]'].find(query=>[...root.querySelectorAll(query)].some(visible));if(!query)continue;const matches=[...root.querySelectorAll(query)].filter(visible),el=matches.at(-1),content=el&&messageText(el);if(!content)continue;const prefix=root.host?safeSelector(root.host):'';if(root.host&&!prefix)continue;values.push({kind:'output',selector:(prefix?prefix+' ':'')+query,read_mode:'last',label:name,preview:content.slice(0,600),type:'text',disabled:false,semantic_role:role,identity_eligible:false});detected=true;}
      const last=headings.filter(item=>item.role===role).at(-1);
      if(!detected&&last)values.push({kind:'output',selector:':hermo-heading-'+role,read_mode:'last',label:name,preview:messageText(last.content).slice(0,600),type:'text',disabled:false,semantic_role:role,identity_eligible:false});
    }
  }
  // Generated media and document downloads are first-class string outputs.
  // Keep URL and caption/name separately so callers choose their own contract.
  const mediaNodes=nodes.filter(el=>el.matches('img,video,audio,a[download],a[href]'));
  // A generated response is appended or replaced on every run. Its temporary
  // image ID/position is not a reusable result locator. Only infer "latest"
  // inside an explicit speaker/result stream; ordinary catalog images retain
  // their individually selected locator.
  const latestMedia=new Map();
  if(target?.connected)for(const query of ['[data-message-author-role="assistant"]','[data-turn="assistant"]','[data-testid="assistant-message"]','[role="log"]']){
    for(const root of roots)for(const tag of ['img','video','audio']){
      const candidates=[...root.querySelectorAll(query+' '+tag)].filter(el=>visible(el)&&resultMedia(el));
      const el=candidates.at(-1);if(!el||latestMedia.has(el))continue;
      const prefix=root.host?safeSelector(root.host):'';if(root.host&&!prefix)continue;
      latestMedia.set(el,(prefix?prefix+' ':'')+query+' '+tag);
    }
  }
  mediaNodes.sort((a,b)=>Number(latestMedia.has(b))-Number(latestMedia.has(a)));
  for(const el of mediaNodes){
    if(values.length>=172)break;
    if(!visible(el)||el.closest('nav,header,aside,[role="navigation"],[data-hermo-ui]')||el.matches('img')&&(el.getBoundingClientRect().width<32||el.getBoundingClientRect().height<32)||/(?:avatar|profile|account|logo|icon)/i.test(['id','class','data-testid'].map(name=>el.getAttribute(name)??'').join(' ')))continue;
    const tag=el.tagName.toLowerCase(),anchor=tag==='a',raw=el.getAttribute('href')??'';
    if(anchor&&!el.hasAttribute('download')&&!/\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|mp3|wav|ogg|pdf|csv|xlsx?|docx?|zip)(?:[?#]|$)/i.test(raw))continue;
    const latest=latestMedia.get(el),path=latest||safeSelector(el);if(!path)continue;
    const attribute=anchor?'href':'src',value=assetValue(el,attribute),kind=anchor?'Download':tag==='img'?'Image':tag==='video'?'Video':'Audio';
    if(value)values.push({kind:'output',selector:path,...latest?{read_mode:'last'}:{},read_attribute:attribute,label:(latest?'Latest '+kind.toLowerCase():kind)+' URL',preview:value.slice(0,600),type:tag==='img'?'image_url':tag==='video'?'video_url':tag==='audio'?'audio_url':'download_url',disabled:false,identity_eligible:false,semantic_role:'media'});
    const caption=anchor?'download':tag==='img'?'alt':undefined,name=caption&&assetValue(el,caption);
    if(name)values.push({kind:'output',selector:path,...latest?{read_mode:'last'}:{},read_attribute:caption,label:(latest?'Latest '+kind.toLowerCase():kind)+(anchor?' filename':' description'),preview:name.slice(0,600),type:'text',disabled:false,identity_eligible:false,semantic_role:'media'});
  }
  // Keep rich paragraphs and response blocks, including text split by inline tags.
  // Explicitly named inline data fields can share a paragraph (for example a
  // birth date and birthplace). Keep their values before considering prose.
  const fieldLeaves=nodes.filter(el=>!el.children.length&&el.matches('span,time')&&(el.hasAttribute('data-field')||el.hasAttribute('itemprop')||el.matches('time[datetime]')||/(?:^|[\s_-])(?:date|location|price|amount|temperature|humidity|value|quantity)(?:$|[\s_-])/i.test(el.getAttribute('class')??'')));
  const outputs=[...fieldLeaves,...nodes.filter(el=>el.matches('output,dd,td,[role="status"],.markdown,p')), ...nodes.filter(el=>!el.children.length&&el.matches('[data-testid],article,[role="article"],li,h1,h2,h3,span,div,label'))];
  const selected=[];
  for(const el of outputs){
    if(values.length>=180)break;
    if(!visible(el)||el.isContentEditable||el.closest('form,a[href]')||target?.connected&&inMessage(el))continue;
    const content=text(el);if(noise(content)||content.length>4096)continue;
    const identity_eligible=identityEligible(el,content);
    if(el.closest('button,[role="button"],nav,[role="navigation"]')&&!identity_eligible)continue;
    // A rich paragraph is one useful result; its inline spans are not separate
    // outputs. A container holding several fields is not another field.
    if(selected.some(node=>node.contains(el)||el.contains(node))||el.querySelector('p,output,dd,td')&&!el.matches('.markdown'))continue;
    const path=safeSelector(el);if(!path||values.some(x=>x.selector===path))continue;
    selected.push(el);values.push({kind:'output',selector:path,label:content.slice(0,100),preview:content.slice(0,600),type:'text',disabled:false,identity_eligible,semantic_role:identity_eligible?'identity':'data'});
  }
  const body=document.body?.innerText?.slice(0,30000)??'',title=document.title;
  const challenge=/verify (you are|you're|that you are) human|checking your browser|security verification|performing security verification|just a moment|captcha/i.test(title+' '+body)||!!document.querySelector('#challenge-running,.cf-challenge,[data-testid="challenge"]');
  const denied=/access denied|temporarily blocked|too many requests/i.test(title+' '+body);
  const authRejected=/this browser or app may not be secure|this browser (is not secure|is not supported)/i.test(title+' '+body);
  const networkError=/^chrome-error:|^about:/.test(location.protocol)||/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT/.test(body);
  const credentials=nodes.some(el=>visible(el)&&el.matches('input[type=password],input[autocomplete=one-time-code],input[name=totpPin]'))||/sign.?in|login|authenticate/i.test(location.pathname+' '+title)&&nodes.some(el=>visible(el)&&el.matches('input[type=email],input[autocomplete=username],input[name=identifier]'));
  const signinButtons=values.filter(el=>el.kind==='button'&&/^(sign in|log in|login)$/i.test(el.label));
  const login=credentials||signinButtons.length>=1&&!values.some(el=>el.kind==='button'&&/log out|sign out/i.test(el.label));
  return {elements:values,challenge,denied,authRejected,networkError,login,credentials,textLength:body.trim().length,readyState:document.readyState};
}
