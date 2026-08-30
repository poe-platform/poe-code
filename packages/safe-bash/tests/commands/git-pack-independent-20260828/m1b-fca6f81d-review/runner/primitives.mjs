import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
export function demand(condition, label) {
  if (!condition) throw new Error(label);
}
export function relative(value) {
  demand(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\\') && !value.includes('\0'), 'PATH_TYPE');
  demand(!path.posix.isAbsolute(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part !== 'AGENTS.md'), 'PATH_DOMAIN');
  return value;
}
export function under(root, name) {
  return path.join(root, relative(name));
}
export function ownData(value, depth = 0, counter = { nodes: 0 }) {
  demand(depth <= 32 && ++counter.nodes <= 16384, 'DATA_BOUND');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    demand(Buffer.byteLength(value) <= 262144, 'DATA_STRING');
    return value;
  }
  if (typeof value === 'number') {
    demand(Number.isFinite(value) && !Object.is(value, -0), 'DATA_NUMBER');
    return value;
  }
  demand(typeof value === 'object', 'DATA_TYPE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  demand(keys.every(key => typeof key === 'string'), 'DATA_SYMBOL');
  if (Array.isArray(value)) {
    const length = descriptors.length;
    demand(length && 'value' in length && Number.isSafeInteger(length.value) && length.value >= 0 && length.value <= 16384, 'DATA_LENGTH');
    demand(keys.length === length.value + 1 && keys.at(-1) === 'length', 'DATA_ARRAY_KEYS');
    const result = [];
    for (let index = 0; index < length.value; index++) {
      const descriptor = descriptors[String(index)];
      demand(keys[index] === String(index) && descriptor && 'value' in descriptor && descriptor.enumerable, 'DATA_HOLE_ACCESSOR');
      result.push(ownData(descriptor.value, depth + 1, counter));
    }
    Object.setPrototypeOf(result, null);
    return result;
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    demand(descriptor && 'value' in descriptor && descriptor.enumerable, 'DATA_ACCESSOR_HIDDEN');
    result[key] = ownData(descriptor.value, depth + 1, counter);
  }
  return result;
}
export function exact(value, keys) {
  const projected = ownData(value);
  demand(projected !== null && typeof projected === 'object' && !Array.isArray(projected), 'RECORD');
  demand(JSON.stringify(Object.keys(projected)) === JSON.stringify(keys), 'RECORD_KEYS_ORDER');
  return JSON.parse(JSON.stringify(projected));
}
export async function regular(filename, expected) {
  demand(await fs.realpath(filename) === filename, `FILE_REALPATH:${filename}`);
  const before = await fs.lstat(filename);
  demand(before.isFile() && !before.isSymbolicLink(), `REGULAR:${filename}`);
  demand(before.size <= 134217728, 'FILE_SIZE');
  if (expected) demand(before.size === expected.bytes && (before.mode & 0o777) === expected.mode, `FILE_PREALLOCATION_BINDING:${filename}`);
  const bytes = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  demand(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.mode === after.mode, 'FILE_CHANGED_DURING_READ');
  const row = { mode: before.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) };
  if (expected) for (const key of ['mode', 'bytes', 'sha256']) demand(row[key] === expected[key], `FILE_BINDING:${filename}:${key}`);
  return { ...row, body: bytes };
}
export async function inventory(root, { links = false, maxFiles = 20000, maxBytes = 1073741824 } = {}) {
  demand(await fs.realpath(root) === root, 'ROOT_REALPATH');
  const rootStat = await fs.lstat(root);
  demand(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'ROOT_KIND');
  const rows = [];
  Object.defineProperty(rows, 'rootMode', { value: rootStat.mode & 0o777 });
  let total = 0;
  async function walk(directory, prefix) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      demand(++walk.count <= maxFiles, 'MEMBERSHIP_BOUND');
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      relative(name);
      const filename = path.join(directory, entry.name);
      const stat = await fs.lstat(filename);
      const row = { path: name, kind: '', mode: stat.mode & 0o777, bytes: 0, sha256: null };
      if (stat.isSymbolicLink()) {
        demand(links, `SYMLINK:${name}`);
        row.kind = 'symlink';
        row.target = await fs.readlink(filename);
      } else if (stat.isDirectory()) {
        row.kind = 'directory';
      } else {
        demand(stat.isFile(), `NONREGULAR:${name}`);
        total += stat.size;
        demand(total <= maxBytes, 'TREE_BYTES');
        Object.assign(row, await regular(filename));
        delete row.body;
        row.kind = 'file';
      }
      rows.push(row);
      if (row.kind === 'directory') await walk(filename, name);
    }
  }
  walk.count = 0;
  await walk(root, '');
  return rows;
}
export async function guard(root, expected, options) {
  const actual = await inventory(root, options);
  const rootMode = expected.rootMode ?? options?.rootMode;
  if (rootMode !== undefined) demand(actual.rootMode === rootMode, 'ROOT_MODE_GUARD');
  demand(JSON.stringify(actual) === JSON.stringify(expected), `FULL_MEMBERSHIP_GUARD:${root}`);
  return sha256(Buffer.from(JSON.stringify(actual)));
}
export async function writeExclusive(filename, bytes, mode = 0o600) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const handle = await fs.open(filename, 'wx', mode);
  try {
    await handle.chmod(mode);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
