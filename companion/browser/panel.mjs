// Runs in Chrome's isolated world. No connection secret enters the page.
export function renderPanel({state,name,controller,generation,logoURL}){
  const id='hermo-connection-panel';let host=document.getElementById(id);
  if(host&&host.__hermoView?.designVersion!==3){host.remove();host=null;}
  if(!host){
    host=document.createElement('div');host.id=id;host.setAttribute('data-hermo-ui','');
    host.style.cssText='position:fixed!important;top:12px!important;right:12px!important;z-index:2147483647!important;display:block!important;width:auto!important;height:auto!important;';
    const root=host.attachShadow({mode:'closed'});
    root.innerHTML=`<style>
      :host{all:initial;color-scheme:light}*{box-sizing:border-box}
      section{font:13px/1.5 "Segoe UI",system-ui,sans-serif;background:#fff;color:#202020;border:1px solid #e3e3e3;border-radius:17px;box-shadow:0 6px 24px #00000012;width:256px;max-width:calc(100vw - 24px);overflow:hidden;animation:arrive 220ms ease-out}
      header{display:flex;align-items:center;gap:10px;padding:12px}
      .creature{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:#f2f2f2;flex:none;transition:transform 180ms ease-out}
      .creature img{display:block;width:26px;height:26px;object-fit:contain}
      header:hover .creature{transform:rotate(-6deg)}
      .identity{flex:1;min-width:0}strong{display:block;font-size:12px;line-height:1.4;font-weight:600}
      small{display:block;font-size:11px;color:#666;line-height:1.5;margin-top:2px;overflow-wrap:anywhere;max-height:33px;overflow:hidden}
      button{font:inherit;line-height:1.4;cursor:pointer;touch-action:manipulation;transition:background-color 140ms ease-out,transform 140ms ease-out}
      button:focus-visible{outline:2px solid #383838;outline-offset:2px}button:disabled{opacity:.45;cursor:not-allowed}
      .collapse{display:grid;place-items:center;flex:none;border:0;background:transparent;color:#777;width:32px;height:32px;border-radius:8px;padding:6px}
      .collapse:hover{background:#f4f4f4;color:#202020}.collapse svg{width:14px;height:14px;transition:transform 160ms ease-out}
      .collapsed .collapse svg{transform:rotate(180deg)}
      .body{border-top:1px solid #eee;padding:12px;animation:reveal 160ms ease-out}
      p{font-size:11px;color:#666;line-height:1.65;margin:0 0 12px;overflow-wrap:anywhere}
      .actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .local{display:flex;align-items:center;gap:6px;font-size:10px;color:#666}.dot{width:5px;height:5px;border-radius:50%;background:#555}
      .stop{border:1px solid #dedede;border-radius:8px;background:#fff;color:#202020;padding:8px 12px;min-height:36px;font-size:11px;font-weight:550}
      .stop:hover:not(:disabled){background:#f5f5f5}.stop:active:not(:disabled){transform:translateY(1px)}
      [data-state=running] .creature,[data-state=pending] .creature,[data-state=reconnecting] .creature{animation:attend 1.8s ease-in-out infinite}
      [data-state=running] .dot,[data-state=pending] .dot,[data-state=reconnecting] .dot{animation:pulse 1.4s ease-in-out infinite}
      [data-state=offline] .creature,[data-state=stopped] .creature{background:#f7f7f7;color:#777}
      [data-state=offline] .dot,[data-state=stopped] .dot{background:#aaa}.collapsed .creature{animation:none}
      @keyframes arrive{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
      @keyframes reveal{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
      @keyframes attend{50%{transform:translateY(-2px) rotate(-4deg)}}
      @keyframes pulse{50%{opacity:.3}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
      [hidden]{display:none!important}
    </style><section aria-label="Hermo connection"><header>
      <span class="creature" aria-hidden="true"><img alt="" width="26" height="26"></span>
      <div class="identity"><strong></strong><small></small></div>
      <button class="collapse" aria-label="Collapse Hermo panel" aria-expanded="true" aria-controls="hermo-panel-body"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg></button>
      </header><div id="hermo-panel-body" class="body"><p class="message"></p><div class="actions"><span class="local"><i class="dot" aria-hidden="true"></i><span>Local connection</span></span><button class="stop">Stop</button></div></div></section>`;
    root.querySelector('.creature img').src=logoURL??globalThis.chrome?.runtime?.getURL?.('hermo-crab.png')??'';
    const view={root,controller,generation,lastSeen:Date.now(),designVersion:3};
    const show=current=>{
      const labels={ready:['Hermo connected','Access is limited to this tab. You can stop it anytime.'],running:['Hermo is working','Following your workflow in this tab.'],pending:['Connecting to Hermo','Waiting for your local workspace.'],reconnecting:['Reconnecting','Checking your local connection.'],stopped:['Connection stopped','Your tab stays open and signed in.'],offline:['Reconnect needed','Open the companion to connect this tab again.']};
      const [title,message]=labels[current]??labels.offline;
      root.querySelector('section').dataset.state=current;root.querySelector('strong').textContent=title;root.querySelector('.message').textContent=message;
      root.querySelector('.stop').disabled=['stopped','offline'].includes(current);
      root.querySelector('.local span').textContent=current==='stopped'?'Access ended':current==='offline'?'Not connected':'Local connection';
    };
    view.show=show;
    const timer=setInterval(()=>{if(!host.isConnected){clearInterval(timer);return;}if(!['stopped','offline'].includes(view.state)&&Date.now()-view.lastSeen>12000)show('offline');},4000);
    Object.defineProperty(host,'__hermoView',{value:view});
    root.querySelector('.collapse').addEventListener('click',e=>{
      const body=root.querySelector('.body'),hidden=!body.hidden;body.hidden=hidden;root.querySelector('section').classList.toggle('collapsed',hidden);
      e.currentTarget.setAttribute('aria-label',hidden?'Expand Hermo panel':'Collapse Hermo panel');e.currentTarget.setAttribute('aria-expanded',String(!hidden));
    });
    root.querySelector('.stop').addEventListener('click',async e=>{
      if(!e.isTrusted)return;e.currentTarget.disabled=true;root.querySelector('strong').textContent='Stopping connection…';
      try{const result=await chrome.runtime.sendMessage({type:'hermo.panel.stop',controller:view.controller});if(!result?.ok)show('offline');}catch{show('offline');}
    });
    document.documentElement.append(host);
  }
  const view=host.__hermoView;if(!view||view.generation>generation)return false;view.generation=generation;view.controller=controller;view.state=state;view.lastSeen=Date.now();
  view.root.querySelector('small').textContent=(name??'Website connection').slice(0,100);view.show(state);return true;
}
