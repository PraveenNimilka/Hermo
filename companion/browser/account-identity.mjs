// Read-only, serialized into the selected tab. Never search conversation text
// for an account name or reuse a previously observed identity as evidence.
export function readAccountIdentityDocument(command){
  try{
    if(location.origin!==command.origin||!location.pathname.startsWith(command.path_prefix))throw Error('ORIGIN_CHANGED');
    const expected=command.identity_text;
    if(typeof expected!=='string'||!expected.trim()||expected.length>300)throw Error('ACTION_UNAVAILABLE');
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !!r.width&&!!r.height&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[hidden],[aria-hidden="true"]');};
    const text=el=>(el.innerText??el.textContent??'').trim();
    const controls=[...document.querySelectorAll('button,[role="button"]')].filter(visible),label=el=>(el.getAttribute('aria-label')??text(el)).trim();
    if([...document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"]')].some(visible)||/this browser or app may not be secure|verify (you are|you're) human|security verification/i.test(document.title+' '+(document.body?.innerText??''))||controls.some(el=>/^(sign in|log in|login)$/i.test(label(el)))&&!controls.some(el=>/log out|sign out/i.test(label(el))))throw Error('LOGIN_REQUIRED');
    const original=[...document.querySelectorAll(command.selector)].filter(visible);
    if(original.length===1&&text(original[0])===expected)return expected;
    // Only a unique stable account/sidebar anchor from the confirmed selector
    // may recover a positional path. No document-wide text matching.
    const anchor=command.selector.split(' > ')[0];
    if(!/^(#[^\s>]+|\[(?:id|data-testid|aria-label|name)="[^"\n]+"\])$/.test(anchor)||!/sidebar|profile|account|user-menu/i.test(anchor))throw Error('ACTION_UNAVAILABLE');
    const roots=[...document.querySelectorAll(anchor)].filter(visible);
    if(roots.length!==1)throw Error('ACTION_UNAVAILABLE');
    const root=roots[0],conversation='[aria-label="Conversation"],[data-message-author-role],[data-turn],[contenteditable],input,textarea';
    if(root.matches('body,html,main,'+conversation)||root.querySelector('[aria-label="Conversation"]'))throw Error('ACTION_UNAVAILABLE');
    const nodes=[root,...root.querySelectorAll('span,div,p,dd,h1,h2,h3,label')];
    if(nodes.length>15000)throw Error('ACTION_UNAVAILABLE');
    const matches=nodes.filter(el=>{
      if(!visible(el)||el.closest(conversation)||text(el)!==expected||[...el.children].some(child=>visible(child)&&text(child)===expected))return false;
      const control=el.closest('a[href],button,[role="button"]');
      if(control&&!/profile|account|user menu/i.test(control.getAttribute('aria-label')??''))return false;
      return true;
    });
    if(matches.length!==1)throw Error('ACTION_UNAVAILABLE');
    return text(matches[0]);
  }catch(error){return {hermo_error:['ORIGIN_CHANGED','LOGIN_REQUIRED'].includes(error.message)?error.message:'ACTION_UNAVAILABLE'};}
}
