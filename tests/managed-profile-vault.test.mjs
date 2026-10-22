import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,symlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createManagedProfileVault} from '../server/managed-profile-vault.mjs';

test('complete profile files persist encrypted, isolate connections and reject tampered archives',()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const directory=resolve('work/profile-vault',randomBytes(8).toString('hex'));
  const secret='synthetic-cookie-and-cache-secret';let store=openStore(directory);
  try{
    let vault=createManagedProfileVault(store,directory),lease=vault.open('conn_first');
    mkdirSync(join(lease.directory,'Default','Cache'),{recursive:true});
    writeFileSync(join(lease.directory,'Default','Cache','entry'),secret);
    writeFileSync(join(lease.directory,'Local State'),'profile-preferences');lease.finish();lease.finish();
    assert.deepEqual(readdirSync(join(directory,'managed-profile-active')),[]);
    assert.equal(vault.has('conn_first'),true);assert.equal(vault.has('conn_second'),false);
    for(const file of ['hermo.sqlite','hermo.sqlite-wal']){
      try{assert.equal(readFileSync(join(directory,file)).includes(Buffer.from(secret)),false);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    store.close();store=openStore(directory);vault=createManagedProfileVault(store,directory);
    lease=vault.open('conn_first');assert.equal(lease.restored,true);
    assert.equal(readFileSync(join(lease.directory,'Default','Cache','entry'),'utf8'),secret);lease.finish({save:false});
    const other=vault.open('conn_second');assert.equal(other.restored,false);other.finish({save:false});
    const row=store.db.prepare('SELECT * FROM managed_profile_files WHERE connection_id=? LIMIT 1').get('conn_first');
    store.db.prepare('INSERT INTO managed_profile_files VALUES (?,?,?)').run('conn_second',row.file_index,row.payload);
    assert.throws(()=>vault.open('conn_second'),/MANAGED_PROFILE_STORAGE_INVALID/);
    vault.forget('conn_second');vault.forget('conn_first');assert.equal(vault.has('conn_first'),false);
    assert.throws(()=>vault.open('../escape'),/MANAGED_PROFILE_STORAGE_INVALID/);
  }finally{store.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});

test('uncommitted working copies are discarded on restart and archive path traversal is rejected',()=>{
  const previous=process.env.HERMO_MASTER_KEY;process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const directory=resolve('work/profile-vault',randomBytes(8).toString('hex')),store=openStore(directory);
  try{
    let vault=createManagedProfileVault(store,directory);const abandoned=vault.open('conn_crashed');
    writeFileSync(join(abandoned.directory,'cookie'),'uncommitted');
    vault=createManagedProfileVault(store,directory);assert.deepEqual(readdirSync(join(directory,'managed-profile-active')),[]);
    store.db.prepare('INSERT INTO managed_profile_files VALUES (?,?,?)').run('conn_attack',0,store.seal({connection_id:'conn_attack',index:0,name:'../outside',bytes:'eA=='}));
    assert.throws(()=>vault.open('conn_attack'),/MANAGED_PROFILE_STORAGE_INVALID/);
    assert.deepEqual(readdirSync(join(directory,'managed-profile-active')),[]);
  }finally{store.close();if(previous===undefined)delete process.env.HERMO_MASTER_KEY;else process.env.HERMO_MASTER_KEY=previous;}
});
