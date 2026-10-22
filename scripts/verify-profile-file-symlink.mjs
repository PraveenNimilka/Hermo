// Run with Windows symbolic-link privilege. Creates only a temporary fixture;
// neither owner data nor browser profiles are opened by this check.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
import {createManagedProfileLocks} from '../server/managed-profile-locks.mjs';

const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'hermo-symbolic-lock-'));
let locks,result={tested_at:new Date().toISOString(),status:'failed'};
try{
  locks=createManagedProfileLocks(directory);
  const target=join(directory,'target'),link=join(directory,'managed-profile-locks','symbolic.sqlite');writeFileSync(target,'untouched');
  symlinkSync(target,link,'file');
  assert.throws(()=>locks.acquire('symbolic'),error=>error.code==='MANAGED_PROFILE_PATH_INVALID');
  const sidecar=join(directory,'managed-profile-locks','sidecar.sqlite-journal');symlinkSync(target,sidecar,'file');
  assert.throws(()=>locks.acquire('sidecar'),error=>error.code==='MANAGED_PROFILE_PATH_INVALID');
  assert.equal(readFileSync(target,'utf8'),'untouched');result={...result,status:'passed',checks:['symbolic lock rejected','symbolic sidecar rejected','target unchanged']};
}catch(error){result.error=error.code??error.message;process.exitCode=1;}
finally{
  locks?.close();const child=relative(base,resolve(directory));assert.ok(child&&child!=='..'&&!child.startsWith('..'+sep));rmSync(directory,{recursive:true,force:true});
  const output=resolve(import.meta.dirname,'../work/profile-file-symlink-result.json');mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));
}
