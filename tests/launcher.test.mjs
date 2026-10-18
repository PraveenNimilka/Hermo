import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const launcher=resolve('scripts/start-hermo.mjs');
const run=(args=[],env={})=>spawnSync(process.execPath,[launcher,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,...env},timeout:15000});
const listen=server=>new Promise(accept=>server.listen(0,'127.0.0.1',()=>accept(server.address().port)));
const close=server=>new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));

test('launcher help and invalid arguments do not install dependencies or start a runtime',()=>{
  assert.equal(run(['--help']).status,0);
  assert.match(run(['--help']).stdout,/Node.js 24\+/);
  assert.equal(run(['--unknown']).status,1);
  for(const port of ['0','65536','not-a-port','4317&echo unsafe']){
    const result=run(['--no-open'],{HERMO_PORT:port});
    assert.equal(result.status,1);assert.match(result.stderr,/HERMO_PORT must be an integer/);
  }
  if(process.platform==='win32'){
    const result=spawnSync('cmd.exe',['/d','/s','/c','""'+resolve('Start Hermo.cmd')+'" --help"'],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:15000});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Start Hermo:/);
  }
});

test('launcher reuses an existing healthy Hermo and refuses an unrelated occupied port',async()=>{
  let hermo=true;
  const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(hermo?{product:'hermo',mode:'local',status:'ok'}:{product:'another-service',status:'ok'}));});
  const port=await listen(server);
  try{
    // Keep the event loop serving the health request while the launcher runs.
    const launch=()=>new Promise((accept,reject)=>{
      const child=spawn(process.execPath,[launcher,'--no-open'],{windowsHide:true,env:{...process.env,HERMO_PORT:String(port)}});
      let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
      child.once('error',reject);child.once('exit',code=>accept({code,output}));
    });
    const reuse=await launch();assert.equal(reuse.code,0,reuse.output);assert.match(reuse.output,/already running/);assert.doesNotMatch(reuse.output,/Building the dashboard/);
    hermo=false;
    const occupied=await launch();assert.equal(occupied.code,1);assert.match(occupied.output,/Port .* is unavailable/);assert.doesNotMatch(occupied.output,/Installing dependencies/);
    assert.equal(server.listening,true,'an unrelated service is never stopped');
  }finally{await close(server);}
});

test('fresh launcher installs, builds, starts and preserves existing files in a path with spaces',{timeout:60000},async()=>{
  mkdirSync('work',{recursive:true});
  const directory=mkdtempSync(resolve('work/launcher space & '));
  mkdirSync(join(directory,'scripts'));mkdirSync(join(directory,'server'));mkdirSync(join(directory,'.hermo'));
  copyFileSync(launcher,join(directory,'scripts','start-hermo.mjs'));
  copyFileSync(resolve('Start Hermo.cmd'),join(directory,'Start Hermo.cmd'));
  writeFileSync(join(directory,'.hermo','owner-backup.txt'),'preserve existing workspace');
  const manifest={name:'hermo-launcher-fixture',version:'1.0.0',private:true,type:'module',devDependencies:{typescript:'file:fixtures/typescript',vite:'file:fixtures/vite'}};
  writeFileSync(join(directory,'package.json'),JSON.stringify(manifest));
  const packages={'':{name:manifest.name,version:manifest.version,devDependencies:manifest.devDependencies}};
  // Local, dependency-free compiler fixtures exercise setup without a registry request.
  for(const [name,entry,body]of [
    ['typescript','bin/tsc',"import{writeFileSync}from'node:fs';writeFileSync('types-checked.txt','checked');"],
    ['vite','bin/vite.js',"import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html','launcher fixture built');"]
  ]){
    mkdirSync(join(directory,'fixtures',name,'bin'),{recursive:true});
    writeFileSync(join(directory,'fixtures',name,'package.json'),JSON.stringify({name,version:'0.0.0',type:'module',private:true}));
    writeFileSync(join(directory,'fixtures',name,entry),body);
    packages['fixtures/'+name]={name,version:'0.0.0',dev:true};
    packages['node_modules/'+name]={resolved:'fixtures/'+name,link:true};
  }
  writeFileSync(join(directory,'package-lock.json'),JSON.stringify({name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages}));
  // This server is a disposable launcher fixture, not a product endpoint.
  writeFileSync(join(directory,'server','index.mjs'),"import{createServer}from'node:http';const server=createServer((req,res)=>{if(req.url==='/fixture-stop'){res.end('stopping');server.close();}else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({product:'hermo',mode:'local',status:'ok'}));}});server.listen(Number(process.env.HERMO_PORT),'127.0.0.1');setTimeout(()=>server.close(),20000).unref();");
  const reservation=createServer(),port=await listen(reservation);await close(reservation);
  const options={cwd:directory,windowsHide:true,env:{...process.env,HERMO_PORT:String(port),npm_config_audit:'false',npm_config_fund:'false'}};
  const child=process.platform==='win32'
    ?spawn('cmd.exe',['/d','/s','/c','""'+join(directory,'Start Hermo.cmd')+'" --no-open"'],{...options,windowsVerbatimArguments:true})
    :spawn(process.execPath,[join(directory,'scripts','start-hermo.mjs'),'--no-open'],options);
  let output='',exited=false;
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const completion=new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',code=>{exited=true;accept(code);});});
  const origin=`http://127.0.0.1:${port}`;
  try{
    let ready=false;
    for(let attempt=0;attempt<200&&!exited;attempt++){
      try{ready=(await (await fetch(origin+'/health',{signal:AbortSignal.timeout(250)})).json()).product==='hermo';}catch{}
      if(ready)break;await delay(100);
    }
    assert.equal(ready,true,output);
    assert.match(output,/Installing dependencies/);assert.match(output,/Building the dashboard/);
    assert.equal(existsSync(join(directory,'node_modules','.hermo-dependencies.sha256')),true);
    assert.equal(readFileSync(join(directory,'types-checked.txt'),'utf8'),'checked');
    assert.equal(readFileSync(join(directory,'dist','index.html'),'utf8'),'launcher fixture built');
    assert.equal(readFileSync(join(directory,'.hermo','owner-backup.txt'),'utf8'),'preserve existing workspace');
    await fetch(origin+'/fixture-stop');assert.equal(await completion,0,output);
  }finally{
    if(!exited){try{await fetch(origin+'/fixture-stop',{signal:AbortSignal.timeout(500)});}catch{}child.kill();}
  }
});
