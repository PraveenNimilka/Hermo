// This static function runs in either an isolated Playwright frame or Chrome's
// isolated extension world. It never evaluates supplied code or fetches URLs.
export function extractOutputDocument(command){
  try{
    let mappingNodes=0;
    const validate=(mapping,depth=0,item=false)=>{
      if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||depth>4||++mappingNodes>64||!['string','number','boolean','url','null','object','array',undefined].includes(mapping.type)||mapping.frame_path?.length||mapping.source||mapping.selector!==undefined&&(typeof mapping.selector!=='string'||!mapping.selector||mapping.selector.length>3000||/[\u0000-\u001f\u007f]/.test(mapping.selector)||/(?:>>|javascript\s*:|(?:^|\s)(?:xpath|text|internal:[\w-]+)\s*=|:(?:has-text|text|text-is|text-matches|nth-match)\s*\(|=>|\b(?:eval|Function)\s*\()/i.test(mapping.selector)))throw Error('ACTION_UNAVAILABLE');
      if(mapping.type==='object'){
        if(!Array.isArray(mapping.fields)||!mapping.fields.length||mapping.fields.length>16)throw Error('ACTION_UNAVAILABLE');
        const names=new Set();for(const child of mapping.fields){if(!/^[a-z][a-z0-9_]{1,39}$/.test(child.name)||names.has(child.name))throw Error('ACTION_UNAVAILABLE');names.add(child.name);validate(child,depth+1);}
      }else if(mapping.type==='array'){
        if(!mapping.selector||mapping.maxItems!==undefined&&(!Number.isInteger(mapping.maxItems)||mapping.maxItems<1||mapping.maxItems>100)||mapping.minItems!==undefined&&(!Number.isInteger(mapping.minItems)||mapping.minItems<0||mapping.minItems>100))throw Error('ACTION_UNAVAILABLE');validate(mapping.items,depth+1,true);
      }else if(!item&&!mapping.selector)throw Error('ACTION_UNAVAILABLE');
    };
    validate(command.mapping);
    if(command.origin&&(location.origin!==command.origin||!location.pathname.startsWith(command.path_prefix??'/')))throw Error('ORIGIN_CHANGED');
    const visible=el=>{if(el.nodeType===9)return true;const rect=el.getBoundingClientRect(),style=getComputedStyle(el);return !!(rect.width&&rect.height&&style.visibility!=='hidden'&&style.display!=='none'&&!el.closest('[data-hermo-ui],[hidden],[aria-hidden="true"],script,style'));};
    if([...document.querySelectorAll('input[type=password]')].some(visible)||/this browser or app may not be secure|verify (you are|you're) human|security verification/i.test(document.body?.innerText??''))throw Error('LOGIN_REQUIRED');
    const key=Symbol.for('hermo.output.observations.v1');
    const registry=globalThis[key]??(globalThis[key]={nodes:new WeakMap(),next:0,document:crypto.randomUUID()}),identities=[];
    const identify=element=>{let id=registry.nodes.get(element);if(!id){id=++registry.next;registry.nodes.set(element,id);}identities.push(id);};
    let visited=0,characters=0,streaming=false;
    const read=(mapping,scope,depth=0)=>{
      if(depth>4||++visited>2000)throw Error('OUTPUT_LIMIT_EXCEEDED');
      const selected=mapping.selector?scope.querySelectorAll(mapping.selector):[scope];if(selected.length>15000)throw Error('OUTPUT_LIMIT_EXCEEDED');
      let matches=[...selected].filter(visible);
      if(mapping.type==='array'){
        if(matches.length>(mapping.maxItems??100))throw Error('OUTPUT_LIMIT_EXCEEDED');
        if(!matches.length&&(mapping.minItems??1)>0&&(mapping.required===false||mapping.nullable))return undefined;
        return matches.map(element=>{identify(element);return read(mapping.items,element,depth+1);});
      }
      if(mapping.read_mode==='last'){
        if(['src','poster','alt'].includes(mapping.read_attribute))matches=matches.filter(el=>!el.closest('nav,header,aside,[role="navigation"],[data-hermo-ui]')&&!/(?:avatar|profile|account|logo|icon)/i.test(['id','class','data-testid'].map(name=>el.getAttribute(name)??'').join(' '))&&(!el.matches('img')||el.getBoundingClientRect().width>=32&&el.getBoundingClientRect().height>=32));
        matches=matches.slice(-1);
      }
      if(matches.length>1)throw Error('ELEMENT_AMBIGUOUS');
      if(!matches.length)return undefined;
      const target=matches[0];identify(target);
      if(target.nodeType!==9&&(target.matches('input,textarea,select,[contenteditable],[data-hermo-ui]')||target.closest('[data-hermo-ui]')))throw Error('ACTION_UNAVAILABLE');
      if(mapping.type==='object'){
        const value={};for(const child of mapping.fields){const raw=read(child,target,depth+1);if(raw!==undefined)value[child.name]=raw;}return value;
      }
      if(target.nodeType===9)throw Error('ACTION_UNAVAILABLE');
      streaming ||= !!target.closest('[aria-busy="true"],[data-is-streaming="true"],[data-is-generating="true"]');
      if(['src','poster'].includes(mapping.read_attribute))streaming ||= target.matches('img')&&(!target.complete||target.naturalWidth===0)||target.matches('video,audio')&&target.readyState<1;
      let value;
      if(mapping.read_attribute){
        if(!['src','href','alt','download','poster'].includes(mapping.read_attribute))throw Error('ACTION_UNAVAILABLE');
        if(['alt','download'].includes(mapping.read_attribute))value=target.getAttribute(mapping.read_attribute)??'';
        else{const raw=mapping.read_attribute==='src'?(target.currentSrc||target.getAttribute('src')||target.querySelector('source[src]')?.getAttribute('src')):target.getAttribute(mapping.read_attribute);if(!raw)return undefined;const url=new URL(raw,location.href);if(!(['https:','http:'].includes(url.protocol)||target.matches('img')&&url.protocol==='blob:'&&url.origin===location.origin)||url.username||url.password)throw Error('MEDIA_UNSUPPORTED');value=url.href;}
      }else value=(target.innerText??target.textContent??'').trim();
      characters+=value.length;if(value.length>4096||characters>131072)throw Error('OUTPUT_LIMIT_EXCEEDED');return value;
    };
    const value=read(command.mapping,document);
    streaming ||= [...document.querySelectorAll('button,[role="button"]')].some(button=>visible(button)&&/^stop$|stop (generating|streaming|response|generation)/i.test(button.getAttribute('aria-label')??button.textContent??''));
    return {value,count:Array.isArray(value)?value.length:value===undefined?0:1,streaming,identity:registry.document+':'+identities.join(',')};
  }catch(error){return {hermo_error:['ORIGIN_CHANGED','LOGIN_REQUIRED','ELEMENT_AMBIGUOUS','OUTPUT_LIMIT_EXCEEDED','MEDIA_UNSUPPORTED'].includes(error.message)?error.message:'ACTION_UNAVAILABLE'};}
}
