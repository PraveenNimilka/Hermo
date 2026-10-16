// Serialized into the selected tab's isolated world. No navigation or mutation.
export function readLegacyChatDocument(command={}){
  try{
    if(command.origin&&(location.origin!==command.origin||!location.pathname.startsWith(command.path_prefix)))throw Error('ORIGIN_CHANGED');
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !!r.width&&!!r.height&&s.display!=='none'&&s.visibility!=='hidden';};
    const controls='button,[role="button"]',excluded='button,[role="button"],input,textarea,select,[contenteditable],.sr-only,[hidden],[aria-hidden="true"]';
    const label=el=>(el.getAttribute('aria-label')||el.getAttribute('title')||(el.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' ').trim()||el.textContent||'').trim();
    const copy=el=>/^copy(?: message| response)?$/i.test(label(el));
    const feedback=el=>/^(good response|bad response|like|dislike|thumbs up|thumbs down|read aloud|read out loud|regenerate|retry|share)(?: response| message)?$/i.test(label(el));
    const text=el=>{
      if(el.matches(excluded)||!visible(el))return '';
      if(!el.querySelector(excluded))return (el.innerText??el.textContent??'').trim();
      function walk(node){
        if(node.nodeType===3)return node.textContent;
        if(node.nodeType!==1||node.matches(excluded)||getComputedStyle(node).display==='none')return '';
        if(node.tagName==='BR')return '\n';
        const value=[...node.childNodes].map(walk).join('');
        return /^(P|DIV|PRE|LI|TR|BLOCKQUOTE|SECTION|ARTICLE)$/.test(node.tagName)?'\n'+value+'\n':value;
      }
      return walk(el).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    };
    const conversations=[...document.querySelectorAll('[aria-label="Conversation"]')].filter(visible);
    if(conversations.length!==1)throw Error('ACTION_UNAVAILABLE');
    const conversation=conversations[0],pairs=[],seen=new Set();
    for(const button of [...conversation.querySelectorAll(controls)].filter(el=>visible(el)&&copy(el))){
      let scope=button.parentElement;
      for(let depth=0;scope&&scope!==conversation&&depth<120;depth++,scope=scope.parentElement){
        const buttons=[...scope.querySelectorAll(controls)].filter(visible);
        if(buttons.filter(copy).length!==1)break;
        if(!buttons.some(feedback)||!scope.querySelector('p,pre,.markdown'))continue;
        // Text may be a direct paragraph sibling of the toolbar, or several
        // blocks behind deep wrappers. Read their common content ancestor;
        // do not require an extra wrapper around every paragraph.
        const blocks=[...scope.querySelectorAll('p,pre,.markdown,blockquote,ul,ol,table')].filter(el=>visible(el)&&!el.closest(excluded)&&!el.contains(button)&&(el.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING));
        if(!blocks.length)continue;
        let body=blocks[0];for(const block of blocks)while(body&&!body.contains(block))body=body.parentElement;
        if(!body||!scope.contains(body))continue;
        let turn=scope,user;
        // Only an adjacent preceding message can supply the prompt. Do not
        // search for the requested input text inside an assistant reply.
        for(let up=0;turn&&turn!==conversation&&up<120;up++,turn=turn.parentElement){
          const previous=turn.previousElementSibling;if(!previous||!visible(previous))continue;
          // User turns can also have Copy/Edit controls. Assistant feedback
          // identifies a prior reply and is the boundary we cannot cross.
          if(previous.matches('[contenteditable],input,textarea')||previous.querySelector('[contenteditable],input,textarea')||[...previous.querySelectorAll(controls)].some(x=>visible(x)&&feedback(x)))break;
          const value=text(previous);if(value&&value.length<=4096){user=previous;break;}
        }
        if(!user)continue;if(seen.has(scope))break;seen.add(scope);pairs.push({scope,user,body});break;
      }
    }
    pairs.sort((a,b)=>a.scope.compareDocumentPosition(b.scope)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    if(!pairs.length)throw Error('ACTION_UNAVAILABLE');
    const latest=pairs.at(-1),streaming=[...document.querySelectorAll(controls)].some(el=>visible(el)&&/^stop$|stop (generating|streaming|response)/i.test(label(el)))||latest.scope.closest('[data-is-streaming="true"],[aria-busy="true"]')!==null;
    const result=role=>{const value=text(role==='user'?latest.user:latest.body);if(!value||value.length>4096)throw Error('ACTION_UNAVAILABLE');return {text:value,count:pairs.length,streaming};};
    if(command.role)return result(command.role);
    return [['user','Latest submitted message'],['assistant','Latest assistant response']].map(([role,name])=>({kind:'output',selector:':hermo-latest-'+role,read_mode:'last',label:name,preview:result(role).text.slice(0,600),type:'text',disabled:false}));
  }catch(error){return {hermo_error:error.message==='ORIGIN_CHANGED'?'ORIGIN_CHANGED':'ACTION_UNAVAILABLE'};}
}
