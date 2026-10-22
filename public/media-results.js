// Shared by the consumer app and dashboard. Asset requests never carry an API key.
const kinds=new Set(['image','video','audio','file']);
export function assetURL(value,baseOrigin){
  if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020\u007f]/.test(value))return null;
  let url;try{url=new URL(value);}catch{return null;}
  if(url.username||url.password||!['http:','https:'].includes(url.protocol))return null;
  if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^\/media\/assets\/[A-Za-z0-9_-]{43}$/.test(url.pathname)&&!url.search&&!url.hash)return url.href;
  // Only the public sandbox can be previewed from the local runtime itself.
  if(url.origin===baseOrigin)return url.pathname.startsWith('/sandbox/')?url.href:null;
  if(url.protocol!=='https:')return null;
  const host=url.hostname.toLowerCase();
  if(!host.includes('.')||host.includes(':')||/\.(?:localhost|local|internal|test|invalid)$/.test(host)||host==='localhost')return null;
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){
    const [a,b]=host.split('.').map(Number);
    if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19))return null;
  }
  return url.href;
}

export function mediaKind(value,schema={},name=''){
  if(kinds.has(schema['x-hermo-media-type']))return schema['x-hermo-media-type'];
  let path;try{path=new URL(value).pathname.toLowerCase();}catch{return null;}
  if(/\.(?:png|jpe?g|gif|webp|avif|svg)$/.test(path))return 'image';
  if(/\.(?:mp4|webm|ogv|mov|m4v)$/.test(path))return 'video';
  if(/\.(?:mp3|wav|ogg|m4a|aac|flac)$/.test(path))return 'audio';
  // Legacy URL fields can still identify opaque CDN links by their declared name.
  if(schema.format==='uri'){
    if(/(?:^|[_.])(?:image|picture|poster)(?:_|$)/i.test(name))return 'image';
    if(/(?:^|[_.])video(?:_|$)/i.test(name))return 'video';
    if(/(?:^|[_.])audio(?:_|$)/i.test(name))return 'audio';
    return 'file';
  }
  return null;
}

function shape(schema,value,path,state={nodes:0}){
  if(++state.nodes>2000)throw Error('Result exceeds the preview limit.');
  if(schema.anyOf){const variant=schema.anyOf.find(entry=>entry.type===(value===null?'null':Array.isArray(value)?'array':typeof value));if(!variant)throw Error('Invalid output '+path);return shape(variant,value,path,state);}
  if(value===null){if(schema.type==='null')return;throw Error('Missing output '+path);}
  if(schema.type==='object'){
    if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid output '+path);
    for(const key of schema.required??[])if(!Object.hasOwn(value,key))throw Error('Required output '+path+'.'+key+' was missing.');
    for(const [key,child] of Object.entries(schema.properties??{}))if(Object.hasOwn(value,key))shape(child,value[key],path?path+'.'+key:key,state);
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??100))throw Error('Invalid collection '+path);
    value.forEach((entry,index)=>shape(schema.items??{},entry,path+'['+index+']',state));
  }else if(typeof value!==schema.type||schema.type==='number'&&!Number.isFinite(value)||schema.type==='string'&&value.length<(schema.minLength??0))throw Error('Invalid output '+path);
}

export function mediaEntries(result,schema,baseOrigin){
  const entries=[];
  function walk(value,field,name,depth=0){
    if(depth>6||entries.length>=100)return;
    if(field.anyOf)field=field.anyOf.find(entry=>entry.type!=='null')??{};
    if(value===null||value===undefined)return;
    if(field.type==='object'){for(const [key,child] of Object.entries(field.properties??{}))if(Object.hasOwn(value,key))walk(value[key],child,name?name+'.'+key:key,depth+1);}
    else if(field.type==='array'&&Array.isArray(value))value.forEach((entry,index)=>walk(entry,field.items??{},name+'['+index+']',depth+1));
    else if(typeof value==='string'){
      const kind=mediaKind(value,field,name),url=assetURL(value,baseOrigin);
      if(kind)entries.push({name,kind,url,blocked:!url});
    }
  }
  walk(result,schema,'');return entries;
}

export function renderMedia(container,entries){
  container.replaceChildren();container.classList.add('media-results');
  for(const entry of entries){
    const card=document.createElement('article'),title=document.createElement('strong');card.className='media-result';title.textContent=entry.name;card.append(title);
    const note=document.createElement('p');note.className='media-preview-status';note.setAttribute('role','status');card.append(note);
    if(entry.blocked){note.textContent='This URL cannot be previewed. Choose a portable HTTPS asset URL from the website.';container.append(card);continue;}
    const link=document.createElement('a');link.href=entry.url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.textContent='Open '+entry.name;
    if(entry.kind==='file'){note.textContent='File link from the verified result.';card.append(link);container.append(card);continue;}
    const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Load '+entry.kind+' preview';
    note.textContent='Loads from '+new URL(entry.url).host+'. Your Hermo key is never sent. The host must permit anonymous media access.';
    button.addEventListener('click',()=>{
      button.remove();const media=document.createElement(entry.kind==='image'?'img':entry.kind);
      media.crossOrigin='anonymous';media.referrerPolicy='no-referrer';media.className='generated-media';
      if(entry.kind==='image'){media.alt=entry.name;media.loading='lazy';media.decoding='async';}
      else{media.controls=true;media.preload='metadata';if(entry.kind==='video')media.playsInline=true;}
      note.textContent='Loading '+entry.kind+' preview…';
      media.addEventListener(entry.kind==='image'?'load':'loadedmetadata',()=>{note.textContent='Preview loaded from the verified URL.';},{once:true});
      media.addEventListener('error',()=>{note.textContent='Preview unavailable: the link may have expired, require website sign-in, or block anonymous embedding. Open the asset in its website; Hermo did not rerun generation.';media.remove();},{once:true});
      media.src=entry.url;card.insertBefore(media,note);
    },{once:true});
    const actions=document.createElement('div');actions.className='media-result-actions';actions.append(button,link);card.append(actions);container.append(card);
  }
}

export function renderVerifiedResults(container,result,schema,{verified=false,baseOrigin=location.origin}={}){
  if(!verified)throw Error('Only verified successful results can be displayed.');
  shape(schema,result,'');const fragment=document.createDocumentFragment(),entries=mediaEntries(result,schema,baseOrigin);
  for(const [name,field] of Object.entries(schema.properties??{})){
    if(!Object.hasOwn(result,name))continue;
    if(entries.some(entry=>entry.name===name||entry.name.startsWith(name+'.')||entry.name.startsWith(name+'[')))continue;
    const card=document.createElement('article'),title=document.createElement('strong'),body=document.createElement(typeof result[name]==='object'&&result[name]!==null?'pre':'p');
    card.className='message assistant';title.textContent=name;body.textContent=typeof result[name]==='object'?JSON.stringify(result[name],null,2):String(result[name]);card.append(title,body);fragment.append(card);
  }
  const media=document.createElement('div');renderMedia(media,entries);fragment.append(media);
  const details=document.createElement('details'),summary=document.createElement('summary'),json=document.createElement('pre');
  summary.textContent='Result JSON';json.textContent=JSON.stringify(result,null,2);json.tabIndex=0;details.className='media-result-json';details.append(summary,json);fragment.append(details);container.replaceChildren(fragment);
}
