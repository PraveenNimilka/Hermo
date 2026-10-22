// Chromium proxies plain WebSockets through CONNECT, which must never tunnel to
// the local owner API. Relay only the already validated /sandbox/ socket instead.
// Public secure sockets continue through the normal DNS-validated HTTPS proxy.
export function relaySandboxSocket(route,context){
  const upstream=new WebSocket(route.url());upstream.binaryType='arraybuffer';
  let queue=[],size=0,closed=false;
  const stop=()=>{if(closed)return;closed=true;queue=[];try{upstream.close();}catch{}context.off('close',stop);};
  context.once('close',stop);
  route.onClose(stop);
  route.onMessage(message=>{
    if(closed)return;
    if(upstream.readyState===WebSocket.OPEN){upstream.send(message);return;}
    size+=typeof message==='string'?Buffer.byteLength(message):message.byteLength;
    if(size>1024*1024||queue.length>=32){stop();void route.close({code:1009});return;}
    queue.push(message);
  });
  upstream.addEventListener('open',()=>{if(closed){upstream.close();return;}for(const message of queue)upstream.send(message);queue=[];});
  upstream.addEventListener('message',event=>{if(!closed)route.send(typeof event.data==='string'?event.data:Buffer.from(event.data));});
  upstream.addEventListener('close',()=>{stop();void route.close();});
  upstream.addEventListener('error',()=>{stop();void route.close({code:1011});});
}
