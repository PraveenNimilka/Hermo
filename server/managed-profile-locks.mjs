import { DatabaseSync } from 'node:sqlite';
import { closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

const heldLocks = new Map();
const error = (code, message) => Object.assign(new Error(message), { code });
const invalidPath = () => error('MANAGED_PROFILE_PATH_INVALID', 'Managed profile lock paths must be ordinary files inside the runtime data directory.');
const pathKey = path => process.platform === 'win32' ? path.toLowerCase() : path;
const inside = (parent, child) => {
  const part = relative(parent, child);
  return part !== '' && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
};

function stat(path) {
  try { return lstatSync(path); }
  catch (cause) { if (cause.code === 'ENOENT') return undefined; throw cause; }
}

// Inspect every existing component, including ancestors of dataDir. realpath
// alone would silently accept a junction and turn it into a different root.
function ordinaryDirectory(path, create = false) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    let item = stat(current);
    if (!item && create) {
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
      item = stat(current);
    }
    if (!item || item.isSymbolicLink() || !item.isDirectory()) throw invalidPath();
  }
  return realpathSync(absolute);
}

function ordinaryFile(path, required = false) {
  const item = stat(path);
  if ((!item && required) || (item && (item.isSymbolicLink() || !item.isFile() || item.nlink !== 1))) throw invalidPath();
  return item;
}

export function createManagedProfileLocks(dataDir) {
  if (typeof dataDir !== 'string' || !dataDir.trim() || dataDir.includes('\0')) throw invalidPath();
  const requestedRoot = resolve(dataDir), root = ordinaryDirectory(requestedRoot, true);
  const directory = join(root, 'managed-profile-locks');
  ordinaryDirectory(directory, true);
  const leases = new Set();
  let closed = false;

  function checkedFile(connectionId) {
    if (typeof connectionId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(connectionId) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(connectionId)) {
      throw error('MANAGED_PROFILE_INVALID_ID', 'A valid managed connection ID is required.');
    }
    if (pathKey(ordinaryDirectory(requestedRoot)) !== pathKey(root)) throw invalidPath();
    const actualDirectory = ordinaryDirectory(directory);
    if (!inside(root, actualDirectory) || pathKey(actualDirectory) !== pathKey(directory)) throw invalidPath();
    const file = join(directory, `${connectionId}.sqlite`);
    if (!inside(root, file)) throw invalidPath();
    for (const suffix of ['', '-journal', '-wal', '-shm']) ordinaryFile(file + suffix);
    return file;
  }

  return {
    acquire(connectionId) {
      if (closed) throw error('MANAGED_PROFILE_LOCKS_CLOSED', 'Managed profile locks are closed.');
      const file = checkedFile(connectionId), key = pathKey(file);
      if (heldLocks.has(key)) throw error('MANAGED_PROFILE_BUSY', 'This managed profile is already in use.');
      if (!ordinaryFile(file)) {
        try { closeSync(openSync(file, 'wx', 0o600)); }
        catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
      }
      checkedFile(connectionId);
      ordinaryFile(file, true);
      if (!inside(root, realpathSync(file))) throw invalidPath();
      let db;
      try {
        db = new DatabaseSync(file);
        // Separate DELETE-journal databases give each connection an independent
        // OS-backed lease. No profile state or credentials are stored here.
        db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;');
        checkedFile(connectionId);
      } catch (cause) {
        db?.close();
        if (cause.errcode === 5 || cause.errcode === 6) throw error('MANAGED_PROFILE_BUSY', 'This managed profile is already in use.');
        throw cause;
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try { db.close(); }
        finally { heldLocks.delete(key); leases.delete(release); }
      };
      heldLocks.set(key, release);
      leases.add(release);
      return release;
    },
    close() {
      if (closed) return;
      closed = true;
      let failure;
      for (const release of [...leases]) {
        try { release(); } catch (cause) { failure ??= cause; }
      }
      if (failure) throw failure;
    },
  };
}
