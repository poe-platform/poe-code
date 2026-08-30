import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export const candidate = '67eab12e315054907ef4ef435c6bbca2f59e0c36';
export const pack = '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const errorRecord = error => ({ name: error?.name, code: error?.code, message: String(error?.message ?? error), stack: error?.stack });
export function requireThat(condition, code, detail) {
  if (!condition) throw Object.assign(new Error(`${code}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`), { code });
}
export function relativeName(name) {
  requireThat(typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !name.includes('\\') && !name.includes('\0'), 'BAD_PATH', name);
  requireThat(!name.split('/').some(part => !part || part === '.' || part === '..'), 'BAD_PATH', name);
  requireThat(!name.split('/').some(part => part.toUpperCase() === 'AGENTS.MD'), 'AGENTS_FORBIDDEN', name);
  return name;
}
export function boundFile(filename, expected, collect = false) {
  requireThat(!filename.split(sep).some(part => part.toUpperCase() === 'AGENTS.MD'), 'AGENTS_FORBIDDEN', filename);
  const declared = resolve(filename);
  requireThat(realpathSync(declared) === declared, 'SYMLINK', declared);
  let current = sep;
  for (const part of declared.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    requireThat(!lstatSync(current).isSymbolicLink(), 'SYMLINK', current);
  }
  const descriptor = openSync(declared, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    requireThat(before.isFile(), 'NOT_REGULAR', declared);
    requireThat(before.size === expected.bytes && before.size <= 160 * 1024 * 1024, 'FILE_LENGTH', declared);
    if (expected.mode !== undefined) requireThat((before.mode & 0o777) === expected.mode, 'FILE_MODE', declared);
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(65536);
    const chunks = [];
    let size = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, expected.bytes - size + 1), null);
      if (!count) break;
      size += count;
      requireThat(size <= expected.bytes, 'FILE_GROWTH', declared);
      digest.update(buffer.subarray(0, count));
      if (collect) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(descriptor);
    const named = lstatSync(declared);
    requireThat(['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]) && named.ino === after.ino && named.dev === after.dev && !named.isSymbolicLink(), 'FILE_CHANGED', declared);
    const sha256 = digest.digest('hex');
    requireThat(size === expected.bytes && sha256 === expected.sha256, 'FILE_HASH', { filename: declared, expected: expected.sha256, actual: sha256 });
    return { bytes: size, sha256, ...(collect ? { data: Buffer.concat(chunks) } : {}) };
  } finally { closeSync(descriptor); }
}
export function checkIdentity(identity) {
  requireThat(identity.candidate === candidate && identity.pack === pack, 'CANDIDATE_BINDING', identity);
}
export function checkRecipe(value, expectedHash) {
  requireThat(hash(JSON.stringify(value)) === expectedHash, 'RECIPE_HASH', expectedHash);
}
export function checkInventory(expected, actual) {
  const wanted = new Map(expected.map(entry => [relativeName(entry.path), entry]));
  requireThat(wanted.size === expected.length, 'DUPLICATE_ENTRY', 'expected');
  requireThat(new Set(actual.map(entry => entry.path)).size === actual.length, 'DUPLICATE_ENTRY', 'actual');
  for (const entry of actual) {
    relativeName(entry.path);
    requireThat(entry.type === 'file', 'ENTRY_TYPE', entry.path);
    const bound = wanted.get(entry.path);
    requireThat(bound, 'UNLISTED_ENTRY', entry.path);
    requireThat(bound.mode === entry.mode, 'ENTRY_MODE', entry.path);
    requireThat(bound.bytes === entry.bytes && bound.sha256 === entry.sha256, 'ENTRY_HASH', entry.path);
  }
  requireThat(actual.length === expected.length, 'MISSING_ENTRY', 'inventory');
}
export function censusRegularTree(root, expected) {
  const found = [];
  const visit = directory => {
    for (const name of readdirSync(directory).sort()) {
      const filename = resolve(directory, name);
      const suffix = relative(root, filename).split(sep).join('/');
      relativeName(suffix);
      const stat = lstatSync(filename);
      requireThat(!stat.isSymbolicLink(), 'ENTRY_TYPE', suffix);
      if (stat.isDirectory()) visit(filename);
      else {
        requireThat(stat.isFile(), 'ENTRY_TYPE', suffix);
        const bound = expected.find(entry => entry.path === suffix);
        requireThat(bound, 'UNLISTED_ENTRY', suffix);
        const receipt = boundFile(filename, bound);
        found.push({ path: suffix, type: 'file', mode: stat.mode & 0o777, ...receipt });
      }
    }
  };
  visit(root);
  checkInventory(expected, found);
  return found;
}
export function continuation(observation, intentionalNegative = false) {
  if (!observation.bindingsIntact || !observation.reaped) return 'STOP';
  if (!observation.natural && !intentionalNegative) return 'STOP';
  return 'CONTINUE';
}
