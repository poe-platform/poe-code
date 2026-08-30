import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { posix } from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function object(type, body) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const framed = Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data]);
  const oid = createHash('sha1').update(framed).digest('hex');
  return { oid, data: deflateSync(framed), path: `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}` };
}
export function index(entries, version = 2, extensions = []) {
  const header = Buffer.alloc(12); header.write('DIRC'); header.writeUInt32BE(version, 4); header.writeUInt32BE(entries.length, 8);
  const records = entries.map(entry => {
    const name = Buffer.from(entry.path), extended = entry.extended === undefined ? 0 : 2;
    const bytes = Buffer.alloc(Math.ceil((62 + extended + name.length + 1) / 8) * 8);
    bytes.writeUInt32BE(entry.mode ?? 0o100644, 24); bytes.writeUInt32BE(entry.size ?? 0, 36);
    Buffer.from(entry.oid, 'hex').copy(bytes, 40);
    bytes.writeUInt16BE((entry.flags ?? 0) | ((entry.stage ?? 0) << 12) | (extended ? 0x4000 : 0) | Math.min(name.length, 4095), 60);
    if (extended) bytes.writeUInt16BE(entry.extended, 62);
    name.copy(bytes, 62 + extended); return bytes;
  });
  const body = Buffer.concat([header, ...records, ...extensions.map(([name, bytes]) => {
    const head = Buffer.alloc(8); head.write(name); head.writeUInt32BE(bytes.length, 4); return Buffer.concat([head, bytes]);
  })]);
  return checksumIndex(body);
}
export function checksumIndex(body) { return Buffer.concat([body, createHash('sha1').update(body).digest()]); }
export function tree(entries) {
  const sorted = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === 0o40000 ? '/' : '')), Buffer.from(right.name + (right.mode === 0o40000 ? '/' : ''))));
  return object('tree', Buffer.concat(sorted.map(entry => Buffer.concat([Buffer.from(`${entry.mode.toString(8)} ${entry.name}\0`), Buffer.from(entry.oid, 'hex')]))));
}
export function commit(treeOid, parents = [], message = 'independent review\n', extra = '') {
  return object('commit', `tree ${treeOid}\n${parents.map(oid => `parent ${oid}\n`).join('')}author Independent <review@example.invalid> 1000000000 +0000\ncommitter Independent <review@example.invalid> 1000000000 +0000\n${extra}\n${message}`);
}
export function tag(target, type = 'commit') { return object('tag', `object ${target}\ntype ${type}\ntag independent\n\nindependent tag\n`); }
export function neutral(records) { return new Map(records.files.map(row => [row.path, { data: Buffer.from(row.base64, 'base64'), mode: row.mode }])); }
export function set(files, name, data, mode = 0o644) { files.set(name, { data: Buffer.isBuffer(data) ? data : Buffer.from(data), mode }); return files; }
export function addObject(files, entry) { set(files, entry.path, entry.data); return entry.oid; }
export function small(entries = [{ path: 'file.txt', before: 'before\n', after: 'after\n', mode: 0o100644 }]) {
  const files = new Map();
  set(files, '.git/HEAD', 'ref: refs/heads/main\n'); set(files, '.git/config', '[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = true\n');
  const items = entries.map(entry => {
    const oid = addObject(files, object('blob', entry.before));
    if (entry.after !== undefined) set(files, entry.path, entry.after, entry.workMode ?? (entry.mode === 0o100755 ? 0o755 : 0o644));
    return { path: entry.path, name: entry.path, mode: entry.mode ?? 0o100644, oid, stage: entry.stage ?? 0 };
  });
  const root = addObject(files, tree(items));
  const head = addObject(files, commit(root));
  set(files, '.git/refs/heads/main', head + '\n'); set(files, '.git/index', index(items));
  return { files, head, root, items };
}
export async function materialize(core, files, options = {}) {
  const raw = options.real ?? new core.MemoryFileSystem();
  await raw.mkdir('/repo', { recursive: true });
  for (const [name, value] of files) {
    await raw.mkdir(posix.dirname('/repo/' + name), { recursive: true });
    if (value.link !== undefined) await raw.symlink(value.link, '/repo/' + name);
    else await raw.writeFile('/repo/' + name, value.data, { mode: value.mode });
  }
  for (const name of options.directories ?? []) await raw.mkdir('/repo/' + name, { recursive: true });
  const calls = [], mutations = [];
  const methods = new Set(['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'symlink', 'link', 'chmod', 'utimes', 'truncate', 'writeStream']);
  let registered = false, streamActive = 0, returned = 0;
  const base = options.readonly ? new core.ReadOnlyFileSystem(raw) : raw;
  const wrapped = new Proxy(base, { get(target, name) {
    if (name === 'capabilities') return { ...target.capabilities, ...options.capabilities };
    if (methods.has(name)) return (...args) => { mutations.push({ name, path: args[0] }); throw new core.FsError('EROFS', { path: args[0] }); };
    const value = target[name];
    if (typeof value !== 'function') return value;
    if (name === 'readStream') return function (file, settings) {
      assert.ok(registered || options.noHook, 'cleanup registered before stream acquisition');
      calls.push({ name, path: file });
      const original = value.call(target, file, settings);
      const stream = options.stream ? options.stream(original, file, settings) : original;
      return (async function* () { streamActive++; try { yield* stream; } finally { streamActive--; returned++; } })();
    };
    return async (...args) => {
      assert.ok(registered || options.noHook, 'cleanup registered before VFS access');
      calls.push({ name, path: args[0] });
      if (options.intercept) { const alternate = await options.intercept(name, args, target); if (alternate?.handled) return alternate.value; }
      return value.apply(target, args);
    };
  } });
  return { raw, fs: wrapped, calls, mutations, register() { registered = true; }, streams() { return { active: streamActive, returned }; } };
}
export async function snapshot(raw) {
  const rows = [];
  async function walk(name) {
    const stat = await raw.lstat(name);
    const row = { path: name, type: stat.type, mode: stat.mode & 0o777 };
    if (stat.type === 'file') { const data = await raw.readFile(name); row.bytes = data.length; row.sha256 = hash(data); }
    if (stat.type === 'symlink') row.target = await raw.readlink(name);
    rows.push(row);
    if (stat.type === 'directory') for (const entry of (await raw.readdir(name)).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) await walk(posix.join(name, entry.name));
  }
  await walk('/repo'); return rows;
}
