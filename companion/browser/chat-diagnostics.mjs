// Read-only, explicitly requested inspection of the selected conversation.
// No cookies, storage, form values, account sidebar or page-wide text export.
export function diagnoseChatDocument(command={}){
  try{
    if(location.origin!==command.origin||!location.pathname.startsWith(command.path_prefix??'/'))throw Error('ORIGIN_CHANGED');
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !!r.width&&!!r.height&&s.display!=='none'&&s.visibility!=='hidden';};
    const conversations=[...document.querySelectorAll('[aria-label="Conversation"]')];
    const excluded='button,[role="button"],input,textarea,select,[contenteditable],.sr-only,[hidden],[aria-hidden="true"]';
    const clean=el=>{
      const walk=node=>{if(node.nodeType===3)return node.textContent;if(node.nodeType!==1||node.matches(excluded)||getComputedStyle(node).display==='none')return '';if(node.tagName==='BR')return '\n';const value=[...node.childNodes].map(walk).join('');return /^(P|DIV|PRE|LI|TR|BLOCKQUOTE|SECTION|ARTICLE)$/.test(node.tagName)?'\n'+value+'\n':value;};
      return walk(el).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    };
    const path=el=>{const parts=[];let node=el;while(node&&!conversations.includes(node)&&parts.length<120){const tag=node.tagName.toLowerCase(),siblings=[...(node.parentElement?.children??[])].filter(x=>x.tagName===node.tagName);parts.unshift(tag+':nth-of-type('+(siblings.indexOf(node)+1)+')');node=node.parentElement;}return node&&conversations.includes(node)?'[aria-label="Conversation"] > '+parts.join(' > '):'outside-conversation';};
    const probes=[];
    for(const field of (command.fields??[]).slice(0,8)){
      if(!['prompt_echo','response','recorded_prompt_echo','recorded_response'].includes(field.name)||typeof field.selector!=='string'||field.selector.length>3000||!field.selector.startsWith('[aria-label="Conversation"] > '))continue;
      const matches=[...document.querySelectorAll(field.selector)].filter(el=>conversations.some(root=>root.contains(el))&&!el.closest('input,textarea,[contenteditable]'));
      probes.push({name:field.name,matches:matches.length,visibleMatches:matches.filter(visible).length,last:matches.filter(visible).slice(-3).map(el=>{const form=!!el.querySelector('input,textarea,select,[contenteditable]');return {path:path(el),display:getComputedStyle(el).display,formDescendant:form,raw:form?'':(el.innerText??el.textContent??'').trim().slice(0,600),clean:form?'':clean(el).slice(0,600),childTags:[...el.children].map(x=>x.tagName.toLowerCase()).slice(0,20)};})});
    }
    const trees=conversations.slice(0,2).map(root=>{
      const nodes=[root,...root.querySelectorAll('*')].slice(0,15000),ids=new Map(nodes.map((el,index)=>[el,index]));
      const meaningful=el=>{const label=(el.getAttribute('aria-label')||el.getAttribute('title')||'').trim();return /^(copy(?: message| response)?|good response|bad response|read (?:out )?aloud|edit message|stop(?: generating)?)$/i.test(label)?label.toLowerCase():undefined;};
      return {display:getComputedStyle(root).display,visible:visible(root),totalNodes:nodes.length,nodes:nodes.slice(-220).map(el=>({id:ids.get(el),parent:ids.get(el.parentElement)??null,tag:el.tagName.toLowerCase(),visible:visible(el),display:getComputedStyle(el).display,textLength:(el.textContent??'').trim().length,...['user','assistant'].includes(el.getAttribute('data-message-author-role')??el.getAttribute('data-turn'))?{author:el.getAttribute('data-message-author-role')??el.getAttribute('data-turn')}:{},...meaningful(el)?{control:meaningful(el)}:{},...el.matches('.sr-only,[aria-hidden="true"],[hidden]')?{excluded:true}:{}}))};
    });
    return {format:'hermo.chat-layout.v1',origin:location.origin,conversationRoots:conversations.length,roleCounts:Object.fromEntries(['user','assistant'].map(role=>[role,document.querySelectorAll('[data-message-author-role="'+role+'"],[data-turn="'+role+'"]').length])),probes,trees};
  }catch(error){return {hermo_error:error.message==='ORIGIN_CHANGED'?'ORIGIN_CHANGED':'PAGE_READ_FAILED'};}
}
