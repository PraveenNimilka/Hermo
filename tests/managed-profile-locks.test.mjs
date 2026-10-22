import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { createManagedProfileLocks } from '../server/managed-profile-locks.mjs';

function fixture(t) {
  const base = resolve(tmpdir()), directory = mkdtempSync(join(base, 'hermo-profile-locks-'));
  t.after(() => {
    const child = relative(base, resolve(directory));
    assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
const hasCode = code => cause => cause.code === code;

test('managed profile leases are independent, exclusive across managers and idempotently released', t => {
  const directory = fixture(t), first = createManagedProfileLocks(directory), second = createManagedProfileLocks(directory);
  t.after(() => { first.close(); second.close(); });
  const release = first.acquire('connection_1');
  assert.throws(() => first.acquire('connection_1'), hasCode('MANAGED_PROFILE_BUSY'));
  assert.throws(() => second.acquire('connection_1'), hasCode('MANAGED_PROFILE_BUSY'));
  const other = second.acquire('connection_2');
  release(); release();
  const next = second.acquire('connection_1');
  next(); other();
  assert.equal(readFileSync(join(directory, 'managed-profile-locks', 'connection_1.sqlite')).length, 0);
  first.close(); first.close();
  assert.throws(() => first.acquire('connection_3'), hasCode('MANAGED_PROFILE_LOCKS_CLOSED'));
  second.acquire('connection_2');
  second.close();
  const third = createManagedProfileLocks(directory);
  third.acquire('connection_2')(); third.close();
});

test('managed profile IDs reject paths and Windows reserved names before creating files', t => {
  const locks = createManagedProfileLocks(fixture(t)); t.after(() => locks.close());
  for (const id of [undefined, null, 3, '', 'a'.repeat(101), '../escape', 'a/b', 'a\\b', 'C:drive', '_first', 'has.dot', 'a\0b', 'NUL', 'con', 'COM1', 'lPt9', 'PRN', 'AUX']) {
    assert.throws(() => locks.acquire(id), hasCode('MANAGED_PROFILE_INVALID_ID'), String(id));
  }
  for (const id of ['a', 'Connection_123-test', `a${'b'.repeat(99)}`, 'CONNECTION', 'COM10']) locks.acquire(id)();
});

async function childLease(t, directory, connectionId = 'shared') {
  const moduleUrl = new URL('../server/managed-profile-locks.mjs', import.meta.url).href;
  const source = `import { createManagedProfileLocks } from ${JSON.stringify(moduleUrl)};
    const locks=createManagedProfileLocks(process.argv[1]);
    try { const release=locks.acquire(process.argv[2]); process.send({ready:true});
      process.on('message', message=>{ if(message==='release'){release(); process.send({released:true});}
        if(message==='close'){locks.close();process.disconnect();} });
    } catch(error) {process.send({code:error.code});process.disconnect();}`;
  const child = fork('--eval', [source, directory, connectionId], { execArgv: ['--input-type=module'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  });
  const message = await Promise.race([
    once(child, 'message').then(([value]) => value),
    once(child, 'exit').then(([code]) => { throw new Error(`Lock child exited ${code}: ${stderr}`); }),
  ]);
  return { child, message };
}

test('SQLite leases reject a separate process and release on explicit close and process death', { timeout: 15000 }, async t => {
  const directory = fixture(t), locks = createManagedProfileLocks(directory); t.after(() => locks.close());
  const release = locks.acquire('shared');
  const blocked = await childLease(t, directory);
  assert.equal(blocked.message.code, 'MANAGED_PROFILE_BUSY');
  release();
  const owner = await childLease(t, directory);
  assert.deepEqual(owner.message, { ready: true });
  assert.throws(() => locks.acquire('shared'), hasCode('MANAGED_PROFILE_BUSY'));
  locks.acquire('different')();
  const released = once(owner.child, 'message'); owner.child.send('release'); await released;
  locks.acquire('shared')();
  const exit = once(owner.child, 'exit'); owner.child.send('close'); await exit;
  const doomed = await childLease(t, directory);
  assert.deepEqual(doomed.message, { ready: true });
  const dead = once(doomed.child, 'exit'); doomed.child.kill('SIGKILL'); await dead;
  locks.acquire('shared')();
});

test('lock directories reject symlinks or junctions at the data root, ancestors and owned child', t => {
  const directory = fixture(t), actual = join(directory, 'actual'); mkdirSync(actual);
  const linked = join(directory, 'linked');
  try { symlinkSync(actual, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (cause) { if (['EPERM', 'EACCES'].includes(cause.code)) { t.skip('Directory links unavailable for this account.'); return; } throw cause; }
  assert.throws(() => createManagedProfileLocks(linked), hasCode('MANAGED_PROFILE_PATH_INVALID'));
  assert.throws(() => createManagedProfileLocks(join(linked, 'nested')), hasCode('MANAGED_PROFILE_PATH_INVALID'));
  const data = join(directory, 'data'); mkdirSync(data);
  symlinkSync(actual, join(data, 'managed-profile-locks'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createManagedProfileLocks(data), hasCode('MANAGED_PROFILE_PATH_INVALID'));
});

test('lock files and SQLite sidecars reject linked files and non-file targets', async t => {
  const directory = fixture(t), locks = createManagedProfileLocks(directory); t.after(() => locks.close());
  const root = join(directory, 'managed-profile-locks'), target = join(directory, 'outside'); writeFileSync(target, 'untouched');
  await t.test('hard-linked lock file and sidecar', t => {
    try { linkSync(target, join(root, 'hardlinked.sqlite')); }
    catch (cause) { if (['EPERM', 'EACCES'].includes(cause.code)) { t.skip('Hard links unavailable for this account.'); return; } throw cause; }
    assert.throws(() => locks.acquire('hardlinked'), hasCode('MANAGED_PROFILE_PATH_INVALID'));
    linkSync(target, join(root, 'sidecar.sqlite-journal'));
    assert.throws(() => locks.acquire('sidecar'), hasCode('MANAGED_PROFILE_PATH_INVALID'));
  });
  await t.test('symbolic lock file', t => {
    try { symlinkSync(target, join(root, 'symbolic.sqlite'), 'file'); }
    catch (cause) { if (['EPERM', 'EACCES'].includes(cause.code)) { t.skip('File symlinks unavailable for this account.'); return; } throw cause; }
    assert.throws(() => locks.acquire('symbolic'), hasCode('MANAGED_PROFILE_PATH_INVALID'));
  });
  mkdirSync(join(root, 'directory.sqlite'));
  assert.throws(() => locks.acquire('directory'), hasCode('MANAGED_PROFILE_PATH_INVALID'));
  assert.equal(readFileSync(target, 'utf8'), 'untouched');
});

test('a replaced lock directory is rejected by an already created manager', t => {
  const directory = fixture(t), locks = createManagedProfileLocks(directory); t.after(() => locks.close());
  const root = join(directory, 'managed-profile-locks'), target = join(directory, 'redirect'); mkdirSync(target);
  rmdirSync(root);
  try { symlinkSync(target, root, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (cause) { if (['EPERM', 'EACCES'].includes(cause.code)) { t.skip('Directory links unavailable for this account.'); return; } throw cause; }
  assert.throws(() => locks.acquire('connection'), hasCode('MANAGED_PROFILE_PATH_INVALID'));
});
