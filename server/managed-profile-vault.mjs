import {lstatSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const failure=()=>Object.assign(Error('MANAGED_PROFILE_STORAGE_INVALID'),{code:'MANAGED_PROFILE_STORAGE_INVALID'});
const inside=(root,path)=>{const part=relative(root,path);return part&&!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
// Complete Chromium directories are encrypted before durable storage. Chromium
// itself needs readable files while running; these working copies are private,
// disposable and never treated as recovery authority after a process crash.
export function createManagedProfileVault(store,dataDir){
  const root=resolve(dataDir,'managed-profile-active');
  mkdirSync(root,{recursive:true,mode:0o700});
  if(lstatSync(root).isSymbolicLink()||realpathSync(root).toLowerCase()!==root.toLowerCase())throw failure();
  if(process.platform==='win32'){
    // mode:0700 does not configure NTFS ACLs. Restrict this newly owned working
    // directory explicitly so another local account cannot read active cookies.
    const command="$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($p,$acl)";
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:root,encoding:'utf8',windowsHide:true,timeout:15000});
    if(result.status!==0)throw Object.assign(failure(),{cause:result.error??result.stderr});
  }
  store.db.exec('CREATE TABLE IF NOT EXISTS managed_profile_files (connection_id TEXT NOT NULL, file_index INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(connection_id,file_index))');
  const leases=new Set();
  function checked(path){if(!inside(root,path)||lstatSync(path).isSymbolicLink())throw failure();return path;}
  function remove(path){checked(path);rmSync(path,{recursive:true,force:true});}
  // Only this private directory's generated working-copy names are eligible.
  // A single runtime owns dataDir's SQLite process lock before construction.
  for(const item of readdirSync(root,{withFileTypes:true})){
    if(!/^profile-[A-Za-z0-9_-]+$/.test(item.name)||!item.isDirectory()||item.isSymbolicLink())throw failure();
    remove(join(root,item.name));
  }
  const safeName=name=>typeof name==='string'&&name.length<2048&&!name.includes('\\')&&!name.includes(':')&&!name.includes('\0')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
  function forget(cid){store.db.prepare('DELETE FROM managed_profile_files WHERE connection_id=?').run(cid);}
  return {
    open(cid){
      if(!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(cid)||leases.has(cid))throw failure();
      leases.add(cid);let directory;
      try{
        directory=mkdtempSync(join(root,'profile-'));
        const rows=store.db.prepare('SELECT file_index,payload FROM managed_profile_files WHERE connection_id=? ORDER BY file_index').all(cid);
        let total=0;
        for(const row of rows){
          const value=store.unseal(row.payload);
          if(value.connection_id!==cid||value.index!==row.file_index||!safeName(value.name))throw failure();
          const file=resolve(directory,...value.name.split('/'));if(!inside(directory,file))throw failure();
          const bytes=Buffer.from(value.bytes,'base64');total+=bytes.length;
          if(bytes.length>64*1024*1024||total>512*1024*1024||rows.length>10000)throw failure();
          mkdirSync(resolve(file,'..'),{recursive:true,mode:0o700});writeFileSync(file,bytes,{flag:'wx',mode:0o600});
        }
        let finished=false;
        return {directory,restored:rows.length>0,finish({save=true}={}){
          if(finished)return;finished=true;
          try{
            if(save){
              const files=[];let total=0;
              const scan=(path,prefix='')=>{
                for(const item of readdirSync(checked(path),{withFileTypes:true})){
                  // Chromium's process locks are not browser state.
                  if(!prefix&&/^(Singleton|DevToolsActivePort)/.test(item.name))continue;
                  const file=join(path,item.name),name=prefix+item.name,stat=lstatSync(file);
                  if(stat.isSymbolicLink()||stat.nlink!==1&&!stat.isDirectory())throw failure();
                  if(stat.isDirectory()){scan(file,name+'/');continue;}
                  if(!stat.isFile()||!safeName(name)||stat.size>64*1024*1024)throw failure();
                  total+=stat.size;if(total>512*1024*1024||files.length>=10000)throw failure();
                  const index=files.length;files.push(store.seal({connection_id:cid,index,name,bytes:readFileSync(file).toString('base64')}));
                }
              };
              scan(directory);
              const point='profile_'+randomUUID().replaceAll('-','');store.db.exec('SAVEPOINT '+point);
              try{forget(cid);const insert=store.db.prepare('INSERT INTO managed_profile_files VALUES (?,?,?)');files.forEach((payload,index)=>insert.run(cid,index,payload));store.db.exec('RELEASE '+point);}
              catch(error){store.db.exec('ROLLBACK TO '+point+'; RELEASE '+point);throw error;}
            }
          }finally{leases.delete(cid);remove(directory);}
        }};
      }catch(error){leases.delete(cid);if(directory)remove(directory);throw error;}
    },forget,
    has:cid=>!!store.db.prepare('SELECT 1 FROM managed_profile_files WHERE connection_id=? LIMIT 1').get(cid),
  };
}
