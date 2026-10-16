import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export function normalChromeArguments(dataDir,options={}){if(options.workspace_id&&!/^browser_[a-f0-9]{24}$/.test(options.workspace_id))throw Error('INVALID_BROWSER');return ['--user-data-dir='+resolve(dataDir,options.workspace_id&&!options.legacy?'browser-workspaces/'+options.workspace_id:'normal-chrome'),'--no-first-run','--no-default-browser-check','--new-window',options.url??'https://accounts.google.com/'];}
export function createNormalChromeLauncher(dataDir){return async(options={})=>{
  const executable=[process.env.HERMO_NORMAL_BROWSER_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p=>p&&existsSync(p));
  if(!executable)throw Error('NORMAL_BROWSER_UNAVAILABLE');
  const args=normalChromeArguments(dataDir,options);await mkdir(args[0].slice('--user-data-dir='.length),{recursive:true,mode:0o700});
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOME|DISPLAY)$/i.test(name)));
  await new Promise((resolve,reject)=>{const child=spawn(executable,args,{detached:true,windowsHide:true,stdio:'ignore',env});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
  // Chrome owns its ordinary profile and sign-in. No CDP, Playwright,
  // fingerprint overrides, proxy or credential-reading process is attached.
};}
