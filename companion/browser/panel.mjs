// Runs in Chrome's isolated world. No connection secret enters the page.
export function renderPanel({state,name,controller,generation}){
  const id='hermo-connection-panel';let host=document.getElementById(id);
  if(!host){
    host=document.createElement('div');host.id=id;host.setAttribute('data-hermo-ui','');
    host.style.cssText='position:fixed!important;top:12px!important;right:12px!important;z-index:2147483647!important;display:block!important;width:auto!important;height:auto!important;';
    const root=host.attachShadow({mode:'closed'});
    root.innerHTML='<style>:host{all:initial}*{box-sizing:border-box}section{font:13px/1.5 "Segoe UI",system-ui,sans-serif;background:#fff;color:#202020;border:1px solid #dedede;border-radius:12px;box-shadow:0 4px 16px #00000014;padding:12px;max-width:min(300px,calc(100vw - 24px))}strong{display:block;font-size:13px;font-weight:600;overflow-wrap:anywhere}small{display:block;font-size:12px;margin:0 0 12px;color:#626262;overflow-wrap:anywhere}button{font:inherit;font-weight:500;min-height:40px;border:1px solid #a5a5a5;background:#fff;color:#202020;border-radius:8px;padding:8px 12px;cursor:pointer}button:hover:not(:disabled){background:#f5f5f5}button:focus-visible{outline:2px solid #383838;outline-offset:3px}button:disabled{opacity:.5;cursor:not-allowed}header{display:flex;align-items:center;gap:16px}header button{min-width:32px;min-height:32px;padding:4px;margin-left:auto;flex:none}.body{margin-top:8px}[hidden]{display:none!important}</style><section aria-label="Hermo connection"><header><strong></strong><button class="collapse" aria-label="Collapse Hermo panel" aria-expanded="true" aria-controls="hermo-panel-body">−</button></header><div id="hermo-panel-body" class="body"><small></small><button class="stop">Stop</button></div></section>';
    const view={root,controller,generation,lastSeen:Date.now()};
    setInterval(()=>{if(!host.isConnected)return;if(!['stopped','offline'].includes(view.state)&&Date.now()-view.lastSeen>12000){root.querySelector('strong').textContent='Hermo · reconnect needed';root.querySelector('.stop').disabled=true;}},4000);Object.defineProperty(host,'__hermoView',{value:view});
    root.querySelector('.collapse').addEventListener('click',e=>{const body=root.querySelector('.body'),hidden=!body.hidden;body.hidden=hidden;e.currentTarget.textContent=hidden?'+':'−';e.currentTarget.setAttribute('aria-label',hidden?'Expand Hermo panel':'Collapse Hermo panel');e.currentTarget.setAttribute('aria-expanded',String(!hidden));});
    root.querySelector('.stop').addEventListener('click',async e=>{
      if(!e.isTrusted)return;e.currentTarget.disabled=true;root.querySelector('strong').textContent='Hermo · stopping…';
      try{await chrome.runtime.sendMessage({type:'hermo.panel.stop',controller:view.controller});}catch{root.querySelector('strong').textContent='Hermo · reconnect needed';}
    });
    document.documentElement.append(host);
  }
  const view=host.__hermoView;if(!view||view.generation>generation)return false;view.generation=generation;view.controller=controller;view.state=state;view.lastSeen=Date.now();
  view.root.querySelector('strong').textContent=state==='ready'?'Hermo connected':state==='running'?'Hermo · running':state==='pending'?'Hermo · connecting':state==='reconnecting'?'Hermo · reconnecting':state==='stopped'?'Hermo · stopped':'Hermo · reconnect needed';
  view.root.querySelector('small').textContent=(name??'Website connection').slice(0,100);
  view.root.querySelector('.stop').disabled=['stopped','offline'].includes(state);return true;
}
