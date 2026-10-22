import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function isPublicIp(value) {
  try {
    let address=ipaddr.parse(value);
    if(address.kind()==='ipv6' && address.isIPv4MappedAddress()) address=address.toIPv4Address();
    return address.range()==='unicast';
  } catch {return false;}
}
export function validateWebsite(value,sandboxOrigin) {
  let url; try {url=new URL(value);} catch {throw new Error('Enter a valid HTTPS website URL.');}
  if(url.username||url.password||url.hash) throw new Error('URLs cannot contain credentials or fragments.');
  if(url.origin===sandboxOrigin && url.pathname.startsWith('/sandbox/')) return url;
  if(url.protocol!=='https:'||url.port&&url.port!=='443'||net.isIP(url.hostname.replace(/^\[|\]$/g,''))||!url.hostname.includes('.')||/localhost$|\.local$|\.internal$/i.test(url.hostname)) throw new Error('Use a public HTTPS hostname. Private networks and IP addresses are blocked.');
  return url;
}
export async function publicAddresses(hostname) {
  const values=await lookup(hostname,{all:true,verbatim:true});
  if(!values.length||values.some(x=>!isPublicIp(x.address))) throw new Error('Private or reserved address blocked.');
  return values.sort((a,b)=>a.family-b.family);
}
export async function publicAddress(hostname) {return (await publicAddresses(hostname))[0];}
export async function connectPublic(hostname,{resolve=publicAddresses,dial=net.connect,timeout=3500}={}) {
  const addresses=await resolve(hostname);
  // Validate every returned address before dialing, including test/injected resolvers.
  if(!addresses.length||addresses.some(a=>!isPublicIp(a.address)))throw new Error('Private or reserved address blocked.');
  let last;
  for(const address of addresses.slice(0,4)){try{return await new Promise((resolve,reject)=>{
    const socket=dial({host:address.address,port:443,family:address.family});
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('CONNECTION_TIMEOUT'));},timeout);
    const error=e=>{clearTimeout(timer);socket.destroy();reject(e);};socket.once('error',error);
    socket.once('connect',()=>{clearTimeout(timer);socket.removeListener('error',error);resolve(socket);});
  });}catch(e){last=e;}}
  throw last??new Error('CONNECTION_FAILED');
}
export async function createEgressProxy(sandboxOrigin,{connect=connectPublic}={}) {
  const policies=new Map(), diagnostics=new Map(),sockets=new Set(),ownedSockets=new Map();
  function own(token,socket,origin){
    const owned=ownedSockets.get(token);
    if(!owned||!policies.get(token)?.has(origin)){socket.destroy();return false;}
    if(owned.has(socket)){owned.set(socket,origin);return true;}
    owned.set(socket,origin);socket.once('close',()=>owned.delete(socket));return true;
  }
  function note(token,url,reason){if(!token||!diagnostics.has(token))return;try{const origin=new URL(url).origin,map=diagnostics.get(token);if(map.size<40)map.set(origin+'|'+reason,{origin,reason,resource:'connection',count:1});}catch{}}
  const register=(origins)=>{
    const token=randomBytes(32).toString('base64url'); policies.set(token,new Set(origins));diagnostics.set(token,new Map());ownedSockets.set(token,new Map());
    return {username:token,password:token,diagnostics:()=>[...(diagnostics.get(token)?.values()??[])],clearDiagnostics:()=>diagnostics.get(token)?.clear(),setOrigins(origins){if(!policies.has(token))throw new Error('PROXY_CLOSED');const allowed=new Set(origins);policies.set(token,allowed);for(const [socket,origin]of ownedSockets.get(token))if(!allowed.has(origin))socket.destroy();},release:()=>{policies.delete(token);diagnostics.delete(token);const owned=ownedSockets.get(token);ownedSockets.delete(token);for(const socket of owned?.keys()??[])socket.destroy();}};
  };
  function policy(req) {
    const raw=req.headers['proxy-authorization'];
    if(!raw?.startsWith('Basic ')) throw new Error('Unauthorized proxy');
    const decoded=Buffer.from(raw.slice(6),'base64').toString('utf8'), parts=decoded.split(':');
    if(parts.length!==2||parts[0].length!==parts[1].length||!timingSafeEqual(Buffer.from(parts[0]),Buffer.from(parts[1]))) throw new Error('Unauthorized proxy');
    const allowed=policies.get(parts[0]); if(!allowed) throw new Error('Unauthorized proxy'); return {allowed,token:parts[0]};
  }
  const server=http.createServer(async(req,res)=>{
    if(!req.headers['proxy-authorization']){res.writeHead(407,{'Proxy-Authenticate':'Basic realm="Hermo runner"'});res.end();return;}
    try {
      const {allowed,token}=policy(req), url=new URL(req.url);
      if(url.origin!==sandboxOrigin||!url.pathname.startsWith('/sandbox/')||!allowed.has(sandboxOrigin)||url.username||url.password) throw new Error('Blocked');
      if(!own(token,req.socket,url.origin))return;
      const headers={...req.headers,host:url.host};
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const upstream=http.request({hostname:'127.0.0.1',port:Number(url.port),path:url.pathname+url.search,method:req.method,headers,agent:false},response=>{response.on('error',()=>res.destroy());res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.once('socket',socket=>own(token,socket,url.origin));
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('error',()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
    } catch {res.writeHead(403);res.end('Network policy blocked this request.');}
  });
  server.on('connect',async(req,client,head)=>{
    if(!req.headers['proxy-authorization']){client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Hermo runner"\r\nConnection: close\r\n\r\n');return;}
    let token,url;
    try {
      const authenticated=policy(req),allowed=authenticated.allowed;token=authenticated.token;url=new URL(`https://${req.url}`);
      if(url.port&&url.port!=='443'||url.username||url.password||net.isIP(url.hostname)) {note(token,url,'PRIVATE_ROUTE_BLOCKED');throw new Error('Blocked');}
      if(!allowed.has(url.origin)){note(token,url,'ORIGIN_NOT_APPROVED');throw new Error('Blocked');}
      if(!own(token,client,url.origin))return;
      let upstream;try{upstream=await connect(url.hostname);}catch(e){note(token,url,e.message.includes('Private')?'PRIVATE_ROUTE_BLOCKED':'CONNECTION_FAILED');throw e;}
      // DNS/dial can complete after release or a scope reduction. Recheck the
      // current grant before exposing a tunnel, then bind both socket ends to it.
      if(client.destroyed||!own(token,upstream,url.origin)){upstream.destroy();return;}
      sockets.add(upstream);upstream.on('close',()=>sockets.delete(upstream));
      upstream.setTimeout(60000,()=>upstream.destroy());
      upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);
    } catch {client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  });
  // CONNECT detaches the HTTP parser. A browser reset can arrive before proxy
  // authorization or DNS completes, so error handling must exist from accept.
  server.on('connection',s=>{sockets.add(s);s.on('error',()=>s.destroy());s.on('close',()=>sockets.delete(s));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,register,async close(){for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};
}
