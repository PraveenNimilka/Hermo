// Runs only in the selected tab's isolated extension world. Frame targets stay
// in memory so a changed page cannot turn an old preview click into a new action.
export function previewDocument(command){
  try{
    if(location.origin!==command.origin||!location.pathname.startsWith(command.path_prefix))throw Error('ORIGIN_CHANGED');
    const key=Symbol.for('hermo.preview.targets.v1');
    const frames=globalThis[key]??(globalThis[key]=new Map());
    const view=()=>[location.href,innerWidth,innerHeight,scrollX,scrollY].join('|');
    const rect=node=>{const b=node.getBoundingClientRect();return [b.x,b.y,b.width,b.height];};
    const name=node=>node.getAttribute('aria-label')??node.textContent?.slice(0,512)??'';
    const hitAt=(x,y)=>{let node=document.elementFromPoint(x*innerWidth,y*innerHeight);for(let n=0;n<20&&node?.shadowRoot;n++){const child=node.shadowRoot.elementFromPoint(x*innerWidth,y*innerHeight);if(!child||child===node)break;node=child;}return node;};
    if(command.op==='register'){
      const age=Date.now()-command.captured_at;
      if(age< -1000||age>4000||Math.abs(command.width/command.height-innerWidth/innerHeight)>.03)return null;
      const roots=[document];for(let i=0;i<roots.length&&i<80;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot&&!node.closest('[data-hermo-ui]'))roots.push(node.shadowRoot);
      const targets=[];
      for(const item of command.elements.filter(item=>item.kind!=='output'&&!item.disabled).slice(0,180)){
        let nodes=[];
        for(const root of roots)try{nodes.push(...root.querySelectorAll(item.selector));}catch{}
        if(nodes.length!==1)continue;
        const node=nodes[0],bounds=rect(node);
        if(!bounds[2]||!bounds[3]||node.closest('[data-hermo-ui]')||node.matches('input[type=password],input[type=file],input[autocomplete=one-time-code]'))continue;
        targets.push({id:crypto.randomUUID(),node,selector:item.selector,kind:item.kind,bounds,name:name(node)});
      }
      const frame_id=crypto.randomUUID();frames.set(frame_id,{at:command.captured_at,view:view(),targets});
      for(const [id,frame]of frames)if(Date.now()-frame.at>5000||frames.size>8)frames.delete(id);
      return frame_id;
    }
    const frame=frames.get(command.frame_id);
    if(!frame||Date.now()-frame.at>5000||frame.view!==view()||!Number.isFinite(command.x)||!Number.isFinite(command.y)||command.x<0||command.x>1||command.y<0||command.y>1)throw Error('ELEMENT_CHANGED');
    const hit=hitAt(command.x,command.y);
    if(!hit||hit.closest('[data-hermo-ui]'))throw Error('ACTION_UNAVAILABLE');
    const candidates=frame.targets.filter(item=>item.node===hit||item.node.contains(hit)||[...(item.node.labels??[])].some(label=>label.contains(hit)));
    const target=candidates.find(item=>!candidates.some(other=>other!==item&&item.node.contains(other.node)));
    if(!target||!target.node.isConnected||target.node.disabled||target.node.getAttribute('aria-disabled')==='true'||target.name!==name(target.node)||rect(target.node).some((value,index)=>Math.abs(value-target.bounds[index])>2))throw Error('ELEMENT_CHANGED');
    return {selector:target.selector,kind:target.kind,guard:{frame_id:command.frame_id,target_id:target.id,x:command.x,y:command.y}};
  }catch(error){return {hermo_error:['ORIGIN_CHANGED','ELEMENT_CHANGED'].includes(error.message)?error.message:'ACTION_UNAVAILABLE'};}
}

export function scrollDocument({delta,x=.5,y=.5}){
  if(!Number.isInteger(delta)||Math.abs(delta)>2000||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return {hermo_error:'ACTION_UNAVAILABLE'};
  let node=document.elementFromPoint(x*innerWidth,y*innerHeight);
  while(node?.shadowRoot){const child=node.shadowRoot.elementFromPoint(x*innerWidth,y*innerHeight);if(!child||child===node)break;node=child;}
  for(;node;node=node.parentElement??node.getRootNode()?.host){
    if(node.closest('[data-hermo-ui]'))continue;
    if(/auto|scroll/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight&&(delta<0?node.scrollTop>0:node.scrollTop+node.clientHeight<node.scrollHeight-1)){node.scrollTop+=delta;return true;}
  }
  window.scrollBy(0,delta);return true;
}
