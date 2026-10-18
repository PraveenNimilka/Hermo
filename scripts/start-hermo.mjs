import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

async function health(origin){
  try{
    const response=await fetch(origin+'/health',{redirect:'error',signal:AbortSignal.timeout(1000)});
    if(!response.ok)return false;
    const data=await response.json();
    return data.product==='hermo'&&data.mode==='local'&&data.status==='ok';
  }catch{return false;}
}

async function reservePort(port){
  return new Promise((accept,reject)=>{
    const socket=createServer(client=>client.destroy());
    socket.once('error',()=>reject(Error(`Port ${port} is unavailable. Stop its process normally or set HERMO_PORT to an unused port. No process was stopped.`)));
    socket.listen(port,'127.0.0.1',()=>accept(()=>new Promise((done,failed)=>socket.close(error=>error?failed(error):done()))));
  });
}

function openDashboard(origin){
  if(process.platform!=='win32')return;
  const opener=spawn('rundll32.exe',['url.dll,FileProtocolHandler',origin],{stdio:'ignore',windowsHide:true});
  opener.on('error',()=>console.warn(`Open ${origin} in your browser.`));
  opener.unref();
}

async function command(args){
  // npm.cmd needs cmd.exe on Windows. Only these fixed, internal commands reach it.
  const executable=process.platform==='win32'?'cmd.exe':'npm';
  const commandArgs=process.platform==='win32'?['/d','/s','/c','npm.cmd '+args.join(' ')]:args;
  await new Promise((accept,reject)=>{
    const child=spawn(executable,commandArgs,{cwd:root,stdio:'inherit',windowsHide:true});
    child.once('error',()=>reject(Error('npm could not start. Install Node.js 24 or newer with npm.')));
    child.once('exit',code=>code===0?accept():reject(Error(`npm ${args.join(' ')} failed. Review the error above; your workspace has not been reset.`)));
  });
}

async function buildStep(file,args,label){
  await new Promise((accept,reject)=>{
    const child=spawn(process.execPath,[join(root,'node_modules',file),...args],{cwd:root,stdio:'inherit',windowsHide:true});
    child.once('error',()=>reject(Error(`${label} could not start. Check the dependency installation.`)));
    child.once('exit',code=>code===0?accept():reject(Error(`${label} failed. Review the error above; your workspace has not been reset.`)));
  });
}

async function main(){
  const args=process.argv.slice(2);
  if(args.some(arg=>!['--no-open','--help'].includes(arg)))throw Error('Usage: node scripts/start-hermo.mjs [--no-open] [--help]');
  if(args.includes('--help')){
    console.log('Start Hermo: install locked dependencies when needed, build, start the local runtime, and open its dashboard.');
    console.log('Requires Node.js 24+ and npm. Set HERMO_PORT (default 4317) and HERMO_DATA_DIR through your environment.');
    console.log('--no-open keeps the browser closed. Keep this terminal open; Ctrl+C stops a newly started runtime.');
    return;
  }
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Hermo requires Node.js 24 or newer. Install it from https://nodejs.org/.');
  console.log('Hermo is free to use under the Hermo License. Read LICENSE before use; third-party and earlier grants remain separate.');
  const portText=process.env.HERMO_PORT??'4317';
  if(!/^\d+$/.test(portText)||Number(portText)<1||Number(portText)>65535)throw Error('HERMO_PORT must be an integer from 1 to 65535.');
  const port=Number(portText),origin=`http://127.0.0.1:${port}`;
  if(await health(origin)){
    console.log(`Hermo is already running at ${origin}. Opening that existing runtime; check that it is your intended workspace.`);
    console.log('No installation or build was performed. Stop that runtime before updating its files.');
    if(!args.includes('--no-open'))openDashboard(origin);
    return;
  }
  // Reserve the address during setup so repeated launches cannot install over each other.
  const releasePort=await reservePort(port);
  try{
    const fingerprint=createHash('sha256').update(readFileSync(join(root,'package.json'))).update(readFileSync(join(root,'package-lock.json'))).update(process.versions.node).update(process.platform).update(process.arch).digest('hex');
    const marker=join(root,'node_modules','.hermo-dependencies.sha256');
    const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
    const dependenciesPresent=Object.keys({...manifest.dependencies,...manifest.devDependencies}).every(name=>existsSync(join(root,'node_modules',name,'package.json')));
    if(!dependenciesPresent||!existsSync(marker)||readFileSync(marker,'utf8')!==fingerprint){
      console.log('Installing dependencies from package-lock.json. First setup requires internet access.');
      await command(['ci','--include=dev']);
      mkdirSync(dirname(marker),{recursive:true});
      writeFileSync(marker,fingerprint);
    }
    console.log('Building the dashboard...');
    // npm's Windows bin shims mishandle ampersands in installation paths.
    await buildStep('typescript/bin/tsc',['--noEmit'],'TypeScript check');
    await buildStep('vite/bin/vite.js',['build'],'Dashboard build');
  }finally{
    await releasePort();
  }
  console.log(`Starting Hermo at ${origin}. Keep this window open. Ctrl+C stops this runtime.`);
  console.log('Closing the dashboard does not stop your APIs. This launcher does not install the Chrome companion.');
  const runtime=spawn(process.execPath,[join(root,'server','index.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});
  let exited=false;
  const completion=new Promise((accept,reject)=>{
    runtime.once('error',()=>{exited=true;reject(Error('The local runtime could not start.'));});
    runtime.once('exit',(code,signal)=>{exited=true;code===0||signal==='SIGINT'||signal==='SIGTERM'?accept():reject(Error('The local runtime stopped with an error. Review the message above; do not delete workspace locks or encryption keys.'));});
  });
  // Observe early failures while readiness is being checked.
  void completion.catch(()=>{});
  const stop=()=>{if(!exited)runtime.kill('SIGTERM');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const deadline=Date.now()+30000;
    while(!exited&&Date.now()<deadline){
      if(await health(origin)){
        if(!args.includes('--no-open'))openDashboard(origin);
        await completion;
        return;
      }
      await delay(250);
    }
    if(exited){await completion;return;}
    stop();
    await completion;
    throw Error('Hermo did not become ready within 30 seconds. Review startup output and try again after resolving the error.');
  }finally{
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
}

main().catch(error=>{console.error(`Hermo: ${error.message}`);process.exitCode=1;});
