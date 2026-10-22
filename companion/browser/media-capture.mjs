// Read only the selected, loaded page-local image. No HTTP requests, cookies,
// filesystem paths or arbitrary download addresses are accepted here.
export async function captureMediaDocument(command){
  try{
    if(location.origin!==command.origin||!location.pathname.startsWith(command.path_prefix??'/'))throw Error('ORIGIN_CHANGED');
    const matches=[...document.querySelectorAll(command.selector)].filter(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return el.matches('img')&&b.width>=32&&b.height>=32&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('nav,header,aside,[data-hermo-ui],[hidden],[aria-hidden="true"]')&&!/(?:avatar|profile|account|logo|icon)/i.test(['id','class','data-testid'].map(name=>el.getAttribute(name)??'').join(' '));});
    const image=command.read_mode==='last'?matches.at(-1):matches.length===1?matches[0]:undefined;
    const source=image&&(image.currentSrc||image.getAttribute('src'));
    if(!image||!image.complete||!image.naturalWidth||source!==command.expected)throw Error('ELEMENT_CHANGED');
    const url=new URL(source);if(url.protocol!=='blob:'||url.origin!==location.origin)throw Error('MEDIA_UNSUPPORTED');
    const response=await fetch(url.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('MEDIA_UNSUPPORTED');
    const mime=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(mime))throw Error('MEDIA_UNSUPPORTED');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8388608)throw Error('MEDIA_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel();}
    if(!image.isConnected||(image.currentSrc||image.getAttribute('src'))!==source)throw Error('ELEMENT_CHANGED');
    let binary='';for(const chunk of chunks)for(let offset=0;offset<chunk.length;offset+=32768)binary+=String.fromCharCode(...chunk.subarray(offset,offset+32768));
    return {mime,data:btoa(binary)};
  }catch(error){return {hermo_error:['ORIGIN_CHANGED','ELEMENT_CHANGED','MEDIA_UNSUPPORTED','MEDIA_TOO_LARGE'].includes(error.message)?error.message:'MEDIA_UNSUPPORTED'};}
}
