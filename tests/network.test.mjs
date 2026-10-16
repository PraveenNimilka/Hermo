import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import { isPublicIp,validateWebsite,createEgressProxy,connectPublic } from '../server/network.mjs';

test('network policy rejects private, mapped, metadata and reserved addresses',()=>{
  for(const value of ['127.0.0.1','10.1.2.3','172.16.0.2','192.168.1.2','169.254.169.254','0.0.0.0','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','224.0.0.1'])assert.equal(isPublicIp(value),false,value);
  assert.equal(isPublicIp('8.8.8.8'),true);
});
test('website admission accepts public HTTPS and only the scoped local sandbox',()=>{
  const origin='http://127.0.0.1:4330';
  for(const value of ['http://example.com','https://127.0.0.1','https://localhost','https://server.local','https://example.com:8443','https://user:pass@example.com','http://127.0.0.1:4330/studio/session','http://127.0.0.1:9999/sandbox/'])assert.throws(()=>validateWebsite(value,origin),undefined,value);
  assert.equal(validateWebsite('https://example.com/',origin).origin,'https://example.com');
  assert.equal(validateWebsite(origin+'/sandbox/',origin).origin,origin);
});
test('proxy denies unauthenticated, unapproved, private and management destinations',async()=>{
  const origin='http://127.0.0.1:4330',proxy=await createEgressProxy(origin),credential=proxy.register([origin,'https://localhost','https://example.com']);
  const port=Number(new URL(proxy.url).port),authorization='Basic '+Buffer.from(credential.username+':'+credential.password).toString('base64');
  const request=(path,auth)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path,headers:auth?{'Proxy-Authorization':auth}:{}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  const connect=(target)=>new Promise((resolve,reject)=>{const socket=net.connect(port,'127.0.0.1',()=>socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${authorization}\r\n\r\n`));socket.once('data',b=>{socket.destroy();resolve(b.toString().split('\r\n')[0]);});socket.on('error',reject);});
  try {
    assert.equal(await request(origin+'/sandbox/'),407);
    assert.equal(await request(origin+'/studio/session',authorization),403);
    assert.equal(await request(origin+'/sandbox/../studio/session',authorization),403);
    assert.equal(await request('http://169.254.169.254/latest/meta-data/',authorization),403);
    assert.match(await connect('localhost:443'),/403/);
    assert.match(await connect('example.com:8443'),/403/);
    assert.match(await connect('accounts.google.com:443'),/403/);
    assert.ok(credential.diagnostics().some(d=>d.origin==='https://accounts.google.com'&&d.reason==='ORIGIN_NOT_APPROVED'));
    assert.equal(JSON.stringify(credential.diagnostics()).includes(credential.password),false);
    credential.clearDiagnostics();assert.deepEqual(credential.diagnostics(),[]);
    credential.release();assert.equal(await request(origin+'/sandbox/',authorization),403);
  } finally {await proxy.close();}
});

test('public connection fallback retries validated addresses and never dials mixed private DNS',async()=>{
  const attempted=[];
  const dial=options=>{attempted.push(options.host);const socket=new EventEmitter();socket.destroy=()=>{};queueMicrotask(()=>options.host==='8.8.8.8'?socket.emit('error',new Error('UNREACHABLE')):socket.emit('connect'));return socket;};
  const socket=await connectPublic('public.example',{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'1.1.1.1',family:4}],dial});assert.ok(socket);assert.deepEqual(attempted,['8.8.8.8','1.1.1.1']);
  attempted.length=0;await assert.rejects(connectPublic('mixed.example',{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],dial}),/Private/);assert.deepEqual(attempted,[]);
});

test('proxy survives a browser resetting an in-flight request',async()=>{
  let started;const requestStarted=new Promise(resolve=>{started=resolve;});
  const fixture=http.createServer((req,res)=>{req.on('error',()=>res.destroy());req.resume();started();});await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.address().port}`,proxy=await createEgressProxy(origin),credential=proxy.register([origin]),port=Number(new URL(proxy.url).port),authorization='Basic '+Buffer.from(credential.username+':'+credential.password).toString('base64');
  let socket;
  try{
    socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});await new Promise(resolve=>socket.once('connect',resolve));socket.write(`POST ${origin}/sandbox/reset HTTP/1.1\r\nHost: 127.0.0.1\r\nProxy-Authorization: ${authorization}\r\nContent-Length: 100\r\n\r\nx`);await requestStarted;socket.resetAndDestroy();await new Promise(resolve=>setTimeout(resolve,50));
    for(let i=0;i<3;i++)await new Promise(resolve=>{const client=net.connect(port,'127.0.0.1',()=>client.write(`CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com\r\nProxy-Authorization: ${authorization}\r\n\r\n`));client.on('error',()=>{});client.once('data',()=>client.resetAndDestroy());client.once('close',resolve);});await new Promise(resolve=>setTimeout(resolve,50));
    const status=await new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:origin+'/sandbox/ready'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});assert.equal(status,407);
  }finally{socket?.destroy();await proxy.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
});
