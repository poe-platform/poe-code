import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const CANDIDATE = 'b8f5d60d75452e1dd181167fb87abd995221f6e3';
export const GLOBAL_MS = 24165000;
export const now = () => process.hrtime.bigint();
export const milliseconds = value => BigInt(value) * 1000000n;
export const minimum = (...values) => values.reduce((left, right) => left < right ? left : right);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireFact(condition, code, detail = '') {
  if (!condition) throw Object.assign(new Error(`${code}: ${detail}`), { code, unsafe: true });
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function keys(value, expected) {
  requireFact(value && !Array.isArray(value) && typeof value === 'object' && canonical(Object.keys(value).sort()) === canonical([...expected].sort()), 'SCHEMA_KEYS');
}
export function inside(root, target) {
  const suffix = relative(root, target);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}
export function safeRelative(value) {
  requireFact(typeof value === 'string' && value.length <= 1024 && value.length > 0 && !isAbsolute(value) && !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => /^[A-Za-z0-9@_.+-]+$/u.test(part) && !['.', '..', '__proto__', 'constructor', 'prototype'].includes(part)), 'RELATIVE_PATH', String(value));
  return value;
}
export function canonicalPath(filename) {
  requireFact(typeof filename === 'string' && isAbsolute(filename) && filename === resolve(filename), 'ABSOLUTE_PATH');
  let current = filename;
  while (true) {
    requireFact(!lstatSync(current).isSymbolicLink(), 'SYMLINK', current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  requireFact(realpathSync(filename) === filename, 'CANONICAL_PATH', filename);
  return filename;
}
export function readRegular(filename, maximum = 16777216) {
  canonicalPath(filename);
  const before = lstatSync(filename);
  requireFact(before.isFile() && before.nlink === 1 && before.size <= maximum, 'REGULAR_FILE', filename);
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try { bytes = readFileSync(descriptor); } finally { closeSync(descriptor); }
  const after = lstatSync(filename);
  requireFact(after.ino === before.ino && after.dev === before.dev && after.mode === before.mode && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs && bytes.length === before.size, 'FILE_CHANGED', filename);
  return bytes;
}
export function fileDigest(filename, maximum = 16777216) {
  canonicalPath(filename);
  const before = lstatSync(filename);
  requireFact(before.isFile() && before.nlink === 1 && before.size <= maximum, 'REGULAR_FILE', filename);
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(65536);
  try {
    let count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count));
  } finally { closeSync(descriptor); }
  const after = lstatSync(filename);
  requireFact(after.ino === before.ino && after.dev === before.dev && after.mode === before.mode && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'FILE_CHANGED', filename);
  return { sha256: digest.digest('hex'), bytes: before.size, mode: before.mode & 4095 };
}
export function parseJson(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/gu) ?? [];
  const stack = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const key = JSON.parse(token);
      const names = stack.at(-1);
      requireFact(names instanceof Set && !names.has(key) && !['__proto__', 'constructor', 'prototype'].includes(key), 'DUPLICATE_JSON_KEY', key);
      names.add(key);
    }
  }
  return JSON.parse(text);
}
export function readBoundJson(filename, expected) {
  requireFact(/^[0-9a-f]{64}$/u.test(expected), 'EXPECTED_HASH');
  const bytes = readRegular(filename);
  requireFact(sha256(bytes) === expected, 'HASH', filename);
  return parseJson(bytes);
}
export function snapshot(root, limits = {}) {
  canonicalPath(root);
  const maximumFile = limits.fileBytes ?? 16777216;
  const maximumBytes = limits.treeBytes ?? 67108864;
  const maximumEntries = limits.entries ?? 4096;
  const files = {};
  const directories = {};
  let count = 0;
  let total = 0;
  const walk = suffix => {
    const filename = suffix ? join(root, suffix) : root;
    const stat = lstatSync(filename);
    requireFact(stat.isDirectory() && !stat.isSymbolicLink(), 'DIRECTORY', filename);
    directories[suffix] = stat.mode & 4095;
    for (const name of readdirSync(filename).sort()) {
      const child = safeRelative(suffix ? `${suffix}/${name}` : name);
      requireFact(++count <= maximumEntries, 'TREE_ENTRIES');
      const childPath = join(root, child);
      const childStat = lstatSync(childPath);
      if (childStat.isDirectory() && !childStat.isSymbolicLink()) walk(child);
      else {
        const descriptor = fileDigest(childPath, maximumFile);
        total += descriptor.bytes;
        requireFact(total <= maximumBytes, 'TREE_BYTES');
        files[child] = descriptor;
      }
    }
  };
  walk('');
  return { files, directories };
}
export function assertTree(root, expected, limits) {
  requireFact(canonical(snapshot(root, limits)) === canonical(expected), 'TREE_INTEGRITY', root);
  return true;
}
export function identity(root) {
  canonicalPath(root);
  const stat = lstatSync(root);
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode & 4095 };
}
export function assertIdentity(root, expected) {
  requireFact(canonical(identity(root)) === canonical(expected), 'ROOT_IDENTITY', root);
}
export function atomicBytes(filename, bytes, maximum = 16777216) {
  requireFact(bytes.length <= maximum && !existsSync(filename), 'EVIDENCE_BOUND_OR_OVERWRITE', filename);
  canonicalPath(dirname(filename));
  const temporary = join(dirname(filename), `pending-${randomUUID()}`);
  const descriptor = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  try { linkSync(temporary, filename); } finally { unlinkSync(temporary); }
  return { path: filename, sha256: sha256(bytes), bytes: bytes.length };
}
export const atomicJson = (filename, value) => atomicBytes(filename, Buffer.from(`${JSON.stringify(value)}\n`));
export function newDirectory(filename, mode = 0o700) {
  canonicalPath(dirname(filename));
  requireFact(!existsSync(filename), 'DIRECTORY_EXISTS', filename);
  mkdirSync(filename, { mode });
  return filename;
}
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const entry of Object.values(value)) deepFreeze(entry); }
  return value;
}
export const describeError = error => ({ code: String(error?.code ?? ''), message: String(error?.message ?? error).slice(0, 8192), unsafe: error?.unsafe !== false });
