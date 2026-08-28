import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, opendir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const REPO = path.resolve(ROOT, '../../..');
export const CHUNK = 65536;
export class Hold extends Error {
  constructor(code, detail = '') { super(`${code}${detail ? `: ${detail}` : ''}`); this.code = code; }
}
export function check(condition, code, detail) { if (!condition) throw new Hold(code, detail); }
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const integer = value => Number.isSafeInteger(value) && value >= 0;
export function relative(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\\') && !value.includes('\0'), 'PATH');
  check(!path.posix.isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'), 'PATH', value);
  return value;
}
export async function regular(root, name) {
  relative(name);
  let current = root;
  const parts = name.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await lstat(current);
    check(!stat.isSymbolicLink(), 'SYMLINK', name);
    check(index === parts.length - 1 ? stat.isFile() : stat.isDirectory(), 'FILE_TYPE', name);
  }
  return current;
}
export async function fingerprint(filename, maximum = Number.MAX_SAFE_INTEGER) {
  const stat = await lstat(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'FILE_BOUND', filename);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const part of createReadStream(filename, { highWaterMark: CHUNK })) {
    bytes += part.byteLength;
    check(bytes <= maximum, 'FILE_GROWTH', filename);
    hash.update(part);
  }
  check(bytes === stat.size, 'FILE_CHANGED', filename);
  return { bytes, sha256: hash.digest('hex'), mode: (stat.mode & 0o777).toString(8).padStart(3, '0') };
}
export async function exactJson(filename, entry) {
  const actual = await fingerprint(filename, entry.bytes);
  check(actual.bytes === entry.bytes && actual.sha256 === entry.sha256, 'JSON_IDENTITY', filename);
  const buffer = Buffer.alloc(entry.bytes);
  const handle = await open(filename, 'r');
  try {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, Math.min(CHUNK, buffer.length - offset), offset);
      check(bytesRead > 0, 'JSON_SHORT'); offset += bytesRead;
    }
    check(sha(buffer) === entry.sha256, 'JSON_CHANGED');
  } finally { await handle.close(); }
  return JSON.parse(buffer.toString('utf8'));
}
export async function writeNew(filename, value) {
  const handle = await open(filename, 'wx', 0o644);
  try { await handle.writeFile(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
export async function inventory(root) {
  const rows = [];
  async function visit(directory, prefix) {
    check(prefix.split('/').length <= 64, 'TREE_DEPTH');
    const entries = [];
    for await (const entry of await opendir(directory)) { check(entries.length < 20000, 'DIRECTORY_ENTRIES'); entries.push(entry); }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const name = prefix + entry.name;
      check(rows.length < 20000, 'TREE_ENTRIES');
      relative(name);
      if (entry.isDirectory()) { rows.push({ path: name, directory: true }); await visit(path.join(directory, entry.name), `${name}/`); }
      else { rows.push({ path: name, ...await fingerprint(await regular(root, name)) }); }
    }
  }
  await visit(root, '');
  return rows;
}
export async function verifyTree(root, entries) {
  const rootStat = await lstat(root);
  check(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'ROOT_TYPE');
  check(Array.isArray(entries) && entries.length > 0 && entries.length <= 10000, 'MANIFEST_COUNT');
  const names = new Set();
  for (const entry of entries) {
    check(!names.has(relative(entry.path)), 'DUPLICATE_INPUT'); names.add(entry.path);
    check(['644', '755'].includes(entry.mode) && integer(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), 'INPUT_DESCRIPTOR');
    const actual = await fingerprint(await regular(root, entry.path), entry.bytes);
    check(actual.bytes === entry.bytes && actual.mode === entry.mode && actual.sha256 === entry.sha256, 'INPUT_IDENTITY', `${entry.path}: expected sha256=${entry.sha256} bytes=${entry.bytes} mode=${entry.mode}; actual sha256=${actual.sha256} bytes=${actual.bytes} mode=${actual.mode}`);
  }
  const actual = (await inventory(root)).filter(entry => !entry.directory).map(entry => entry.path).sort();
  check(JSON.stringify(actual) === JSON.stringify([...names].sort()), 'UNDECLARED_INPUT');
  const allowedDirectories = new Set();
  for (const name of names) { let directory = path.posix.dirname(name); while (directory !== '.') { allowedDirectories.add(directory); directory = path.posix.dirname(directory); } }
  check((await inventory(root)).filter(entry => entry.directory).every(entry => allowedDirectories.has(entry.path)), 'UNDECLARED_DIRECTORY');
}
export async function toolIdentity(filename) { const resolved = await realpath(filename); return { path: resolved, ...await fingerprint(resolved) }; }
export function bytes(datum) {
  const keys = ['utf8', 'hex', 'base64'].filter(key => Object.hasOwn(datum, key));
  check(keys.length === 1 && typeof datum[keys[0]] === 'string', 'BYTE_DATUM');
  return Buffer.from(datum[keys[0]], keys[0] === 'utf8' ? 'utf8' : keys[0]);
}
export function reasonIdentity(reason, references) {
  const identity = references.findIndex(reference => Object.is(reference, reason));
  return { identity: identity < 0 ? null : identity, type: typeof reason, code: reason instanceof Hold ? reason.code : null };
}
