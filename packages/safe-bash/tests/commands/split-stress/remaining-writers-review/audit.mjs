import fs from 'node:fs';
import promises from 'node:fs/promises';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const configuration = JSON.parse(process.env.REVIEW_AUDIT);
const originals = { writeSync: fs.writeSync, realpathSync: fs.realpathSync, readFileSync: fs.readFileSync };
const descriptors = new Map();
const log = join(configuration.logs, `${process.pid}.jsonl`);
const logDescriptor = fs.openSync(log, 'ax', 0o600);
const within = (root, path) => { const suffix = relative(root, path); return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('../')); };
function absolute(path) {
  if (typeof path === 'number') return descriptors.get(path) ?? `unknown-fd:${path}`;
  if (path && typeof path === 'object' && 'fd' in path) return descriptors.get(path.fd) ?? `unknown-fd:${path.fd}`;
  return resolve(path instanceof URL ? fileURLToPath(path) : Buffer.isBuffer(path) ? path.toString() : path);
}
function resolved(path) {
  if (path.startsWith('unknown-fd:')) return path;
  try { return originals.realpathSync(path); }
  catch { const parent = dirname(path); return parent === path ? path : join(resolved(parent), relative(parent, path)); }
}
function record(event) {
  originals.writeSync(logDescriptor, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, mode: configuration.mode, ...event }) + '\n');
}
function mutation(operation, values) {
  const paths = values.map(absolute);
  const realpaths = paths.map(resolved);
  const authorityPaths = /\.unlink(?:Sync)?$/.test(operation) ? paths.map(path => join(resolved(dirname(path)), relative(dirname(path), path))) : realpaths;
  const blocked = paths.some((path, index) => path.startsWith('unknown-fd:') || configuration.protected.some(root => within(root, path) || within(root, authorityPaths[index])));
  record({ event: 'mutation-attempt', operation, paths, realpaths, authorityPaths, blocked });
  if (blocked) throw Object.assign(new Error(`REVIEW_WRITE_BLOCKED: ${operation}: ${paths.join(', ')}`), { code: 'REVIEW_WRITE_BLOCKED' });
}
const writes = flags => typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0 : /[wa+]/.test(flags ?? 'r');
const positions = {
  writeFile: [0], appendFile: [0], truncate: [0], unlink: [0], rm: [0], rmdir: [0], mkdir: [0], mkdtemp: [0],
  rename: [0, 1], copyFile: [1], cp: [1], link: [1], symlink: [1], chmod: [0], chown: [0], lchmod: [0], lchown: [0], utimes: [0], lutimes: [0],
  write: [0], writev: [0], ftruncate: [0], fchmod: [0], fchown: [0], futimes: [0],
};
for (const [name, indices] of Object.entries(positions)) {
  for (const [target, method, family] of [[fs, name, 'callback'], [fs, `${name}Sync`, 'sync'], [promises, name, 'promise']]) {
    if (typeof target[method] !== 'function') continue;
    const original = target[method];
    target[method] = function (...args) {
      try { mutation(`${family}.${method}`, indices.map(index => args[index])); }
      catch (error) {
        if (family === 'promise') return Promise.reject(error);
        if (family === 'callback' && typeof args.at(-1) === 'function') { queueMicrotask(() => args.at(-1)(error)); return; }
        throw error;
      }
      const result = Reflect.apply(original, this, args);
      if (family === 'promise' && name === 'writeFile' && /\/virtual-bash-split-capture-[^/]+\/[^/]+\.json$/.test(absolute(args[0]))) {
        return result.then(value => { record({ event: 'report-published', path: absolute(args[0]), base64: Buffer.from(args[1]).toString('base64') }); return value; });
      }
      return result;
    };
  }
}
const originalOpenSync = fs.openSync;
fs.openSync = function (path, flags, ...args) {
  if (writes(flags)) mutation('sync.openSync', [path]);
  const descriptor = originalOpenSync.call(this, path, flags, ...args);
  descriptors.set(descriptor, absolute(path));
  return descriptor;
};
const originalOpen = fs.open;
fs.open = function (path, flags, ...args) {
  const callback = args.pop();
  try { if (writes(flags)) mutation('callback.open', [path]); }
  catch (error) { queueMicrotask(() => callback(error)); return; }
  return originalOpen.call(this, path, flags, ...args, (error, descriptor) => {
    if (!error) descriptors.set(descriptor, absolute(path));
    callback(error, descriptor);
  });
};
const originalPromiseOpen = promises.open;
promises.open = async function (path, flags, ...args) {
  if (writes(flags)) mutation('promise.open', [path]);
  const handle = await originalPromiseOpen.call(this, path, flags, ...args);
  descriptors.set(handle.fd, absolute(path));
  for (const method of ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown', 'utimes', 'createWriteStream']) {
    const original = handle[method];
    if (typeof original !== 'function') continue;
    handle[method] = function (...values) {
      try { mutation(`FileHandle.${method}`, [path]); }
      catch (error) { if (method === 'createWriteStream') throw error; return Promise.reject(error); }
      return Reflect.apply(original, this, values);
    };
  }
  return handle;
};
const originalStream = fs.createWriteStream;
fs.createWriteStream = function (path, options) {
  mutation('createWriteStream', [options?.fd ?? path]);
  return originalStream.call(this, path, options);
};
const originalSpawn = childProcess.spawnSync;
childProcess.spawnSync = function (command, args, options = {}) {
  const native = configuration.native.find(entry => entry.path === resolved(absolute(command)));
  if (!native) {
    if (resolved(absolute(command)) !== resolved(process.execPath)) {
      record({ event: 'unapproved-child', command, args });
      throw new Error(`Unapproved child: ${command}`);
    }
    record({ event: 'node-child', command, args, cwd: options.cwd });
    const result = originalSpawn.call(this, command, args, options);
    record({ event: 'node-child-result', status: result.status, signal: result.signal, error: result.error ? String(result.error) : null, stdoutBase64: Buffer.from(result.stdout ?? '').toString('base64'), stderrBase64: Buffer.from(result.stderr ?? '').toString('base64') });
    return result;
  }
  const cwd = resolved(absolute(options.cwd));
  const sha256 = createHash('sha256').update(originals.readFileSync(command)).digest('hex');
  const allowed = sha256 === native.sha256 && within(configuration.temporary, cwd) && !configuration.protected.some(root => within(root, cwd));
  record({ event: 'native-start', command, args, cwd, sha256, allowed, timeout: options.timeout, env: options.env });
  if (!allowed) throw new Error('Native prerequisite/cwd changed');
  const result = originalSpawn.call(this, command, args, options);
  record({ event: 'native-end', command, cwd, status: result.status, signal: result.signal, error: result.error ? String(result.error) : null });
  return result;
};
syncBuiltinESMExports();
record({ event: 'installed', argv: process.argv, protected: configuration.protected });
