import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { fixtures } from './corpus.mjs';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

export function fixtureFileSystem(makeError, configuration = {}) {
  const calls = [];
  const storageScope = {};
  const scopes = new Map();
  const nodes = new Map([['/', { type: 'directory', inode: 1 }]]);
  const normalize = (entryPath) => posix.resolve('/', entryPath);
  function add(entryPath, type, value) {
    const key = normalize(entryPath);
    if (key !== '/' && !nodes.has(posix.dirname(key))) add(posix.dirname(key), 'directory');
    nodes.set(key, { type, value, inode: nodes.size + 1 });
  }
  for (const [root, entries] of Object.entries(fixtures)) {
    add(`/${root}`, 'directory');
    for (const [kind, name, value] of entries) add(`/${root}/${name}`, { d: 'directory', f: 'file', l: 'symlink' }[kind], value);
  }
  const error = (code, entryPath, syscall) => makeError(code, { path: entryPath, syscall });
  function resolve(entryPath, follow = true, hops = 0) {
    if (hops > 40) throw error('ELOOP', entryPath, 'resolve');
    const parts = normalize(entryPath).split('/').filter(Boolean);
    let actual = '/';
    for (const [index, part] of parts.entries()) {
      actual = posix.join(actual, part);
      const node = nodes.get(actual);
      if (!node) throw error('ENOENT', entryPath, 'resolve');
      if (node.type === 'symlink' && (follow || index < parts.length - 1)) {
        return resolve(posix.resolve(posix.dirname(actual), node.value, ...parts.slice(index + 1)), true, hops + 1);
      }
      if (index < parts.length - 1 && node.type !== 'directory') throw error('ENOTDIR', entryPath, 'resolve');
    }
    return actual;
  }
  async function enter(method, entryPath, options) {
    const entry = { method, path: normalize(entryPath), signal: options?.signal };
    calls.push(entry);
    if (calls.length > (configuration.hardCallLimit ?? 160)) throw error('EFBIG', entryPath, method);
    options?.signal?.throwIfAborted();
    if (configuration.before) await configuration.before(entry, error);
  }
  function metadata(actual) {
    const node = nodes.get(actual);
    const base = { type: node.type, size: Buffer.byteLength(node.value ?? ''), mode: node.type === 'directory' ? 0o755 : 0o644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 };
    if (configuration.identity === 'unknown') return { ...base, dev: 7, ...(actual.includes('grandchild') ? {} : { ino: 9 }) };
    if (configuration.identity === 'disjoint') {
      if (!scopes.has(actual)) scopes.set(actual, Object.freeze({ description: 'same-description' }));
      return { ...base, identityScope: scopes.get(actual), dev: 7, ino: 9 };
    }
    return { ...base, identityScope: storageScope, dev: 7, ino: node.inode };
  }
  const filesystem = {
    capabilities: Object.freeze({ readOnly: true, symlinks: true }),
    async stat(entryPath, options) { await enter('stat', entryPath, options); return metadata(resolve(entryPath)); },
    async lstat(entryPath, options) { await enter('lstat', entryPath, options); return metadata(resolve(entryPath, false)); },
    async realpath(entryPath, options) {
      await enter('realpath', entryPath, options);
      if (configuration.noRealpath) throw error('ENOTSUP', entryPath, 'realpath');
      return resolve(entryPath);
    },
    async readlink(entryPath, options) {
      await enter('readlink', entryPath, options);
      const node = nodes.get(resolve(entryPath, false));
      if (node.type !== 'symlink') throw error('EINVAL', entryPath, 'readlink');
      return node.value;
    },
    async readdir(entryPath, options) {
      await enter('readdir', entryPath, options);
      const actual = resolve(entryPath);
      if (nodes.get(actual).type !== 'directory') throw error('ENOTDIR', entryPath, 'readdir');
      const entries = [...nodes].filter(([key]) => key !== actual && posix.dirname(key) === actual)
        .map(([key, node]) => ({ name: posix.basename(key), type: node.type }));
      return configuration.listing ? configuration.listing(actual, entries) : entries;
    },
    async access(entryPath, mode, options) { await enter('access', entryPath, options); resolve(entryPath); },
    async readFile(entryPath, options) { await enter('readFile', entryPath, options); throw error('EIO', entryPath, 'forbidden-content-read'); },
  };
  for (const method of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'symlink', 'link', 'chmod', 'utimes', 'truncate']) {
    filesystem[method] = async (entryPath) => { await enter(method, entryPath); throw error('EROFS', entryPath, method); };
  }
  if (configuration.missingRealpath) delete filesystem.realpath;
  return { filesystem, calls, nodes, resolve };
}

export function captureSink(options = {}) {
  const chunks = [];
  const retained = [];
  let active = 0;
  let maxActive = 0;
  let writes = 0;
  return {
    sink: { async write(chunk) {
      assert.ok(chunk instanceof Uint8Array, 'byte sink receives Uint8Array');
      active++;
      maxActive = Math.max(maxActive, active);
      writes++;
      const copy = Buffer.from(chunk);
      retained.push({ original: chunk, copy });
      try {
        if (options.before) await options.before({ index: writes, chunk: copy });
        chunks.push(copy);
        assert.ok(chunks.reduce((sum, item) => sum + item.length, 0) <= 512 * 1024, 'harness output hard ceiling');
      } finally { active--; }
    } },
    bytes: () => Buffer.concat(chunks),
    statistics: () => ({ active, maxActive, writes }),
    verifyOwnership: () => { for (const { original, copy } of retained) assert.deepEqual(Buffer.from(original), copy); },
  };
}
