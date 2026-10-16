import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const id = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`;
export const hash = (value) => createHash('sha256').update(value).digest('hex');
const scryptAsync = promisify(scrypt);
export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await scryptAsync(password, salt, 64, {N:32768,r:8,p:1,maxmem:64*1024*1024});
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = (await passwordHash(password, salt)).split(':')[1];
  return timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}
function dpapi(value, protect) {
  const command = `Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[System.Security.Cryptography.ProtectedData]::${protect?'Protect':'Unprotect'}($v,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command], {input:value,encoding:'utf8',windowsHide:true,timeout:15000});
  if(result.status!==0) throw new Error('OS key protection unavailable; refusing to store an unprotected key.');
  return result.stdout.trim();
}
function acquireRuntimeLock(directory) {
  const lock=new DatabaseSync(join(directory,'runtime-lock.sqlite'));
  try {
    // Keep this separate from the WAL data store: SQLite's OS-backed exclusive
    // transaction is released on process death without stale-file/PID races.
    lock.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;');
    return lock;
  } catch(error) {
    lock.close();
    if(error.errcode===5||error.errcode===6)throw Object.assign(new Error('Another Hermo runtime is already using this data directory. Stop that runtime before starting another.'),{code:'RUNTIME_ALREADY_RUNNING'});
    throw error;
  }
}
export function openStore(directory) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const runtimeLock=acquireRuntimeLock(directory);
  let key,db,closed=false;
  try {
  if(process.env.HERMO_MASTER_KEY) {
    key=Buffer.from(process.env.HERMO_MASTER_KEY,'base64');
    if(key.length!==32) throw new Error('HERMO_MASTER_KEY must encode exactly 32 bytes.');
  } else if(process.platform==='win32') {
    const file=join(directory,'master.dpapi');
    if(!existsSync(file)) writeFileSync(file,dpapi(randomBytes(32).toString('base64'),true),{mode:0o600,flag:'wx'});
    key=Buffer.from(dpapi(readFileSync(file,'utf8'),false),'base64');
  } else throw new Error('Set a 32-byte base64 HERMO_MASTER_KEY using a secret manager on this platform.');
  const seal=(value)=>{
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
  };
  const unseal=(value)=>{
    const packed=Buffer.from(value,'base64'), decipher=createDecipheriv('aes-256-gcm',key,packed.subarray(0,12));
    decipher.setAuthTag(packed.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)),decipher.final()]).toString('utf8'));
  };
  db=new DatabaseSync(join(directory,'hermo.sqlite'));
  // SQLite creates a consistent snapshot including committed WAL contents before migration.
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connections'").get()&&!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='browser_workspaces'").get()){
    const backup=join(directory,'before-browser-workspaces.sqlite');
    if(!existsSync(backup))db.prepare('VACUUM INTO ?').run(backup);
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS browser_workspaces (id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES connections(id),name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,status TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL,test_version TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,suffix TEXT NOT NULL,workflow_id TEXT NOT NULL REFERENCES workflows(id),expires_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL REFERENCES workflows(id),consumer_id TEXT NOT NULL,idem TEXT NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(consumer_id,workflow_id,idem));
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY,event TEXT NOT NULL,resource_id TEXT,created_at TEXT NOT NULL);
  `);
  const getSetting=(name)=>db.prepare('SELECT value FROM settings WHERE key=?').get(name)?.value;
  const setSetting=(name,value)=>db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(name,value);
  const audit=(event,resource)=>db.prepare('INSERT INTO audit VALUES (?,?,?,?)').run(id('audit'),event,resource??null,new Date().toISOString());
  return {db,seal,unseal,getSetting,setSetting,audit,close(){
    if(closed)return;closed=true;
    try{db.close();}finally{key.fill(0);runtimeLock.close();}
  }};
  }catch(error){
    try{db?.close();}finally{key?.fill(0);runtimeLock.close();}
    throw error;
  }
}
