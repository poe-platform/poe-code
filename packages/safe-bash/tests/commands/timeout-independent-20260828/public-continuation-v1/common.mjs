import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const recipe = dirname(fileURLToPath(import.meta.url));
export const owned = resolve(recipe, '..');
export const repository = resolve(owned, '../../..');
export const freeze = resolve(owned, 'public-integration-freeze-v1');
export const freezeHash = '18e3c23c425065f79c92ff6a17e7853c643e316db3e38d5806c3450a63448991';
export const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
export const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const fileHash = filename => sha(fs.readFileSync(filename));
export const read = filename => JSON.parse(fs.readFileSync(filename));
export function safe(value) {
  assert.equal(typeof value, 'string', 'UNSAFE_PATH');
  assert.ok(value && !value.startsWith('/') && !/[\\\0]/u.test(value), 'UNSAFE_PATH');
  assert.ok(value.split('/').every(part => part && part !== '.' && part !== '..'), 'UNSAFE_PATH');
  assert.ok(!value.split('/').some(part => part.toLowerCase() === 'agents.md'), 'AGENTS_NAME');
  return value;
}
export function write(filename, bytes) {
  assert.ok(resolve(filename).startsWith(`${recipe}/`), 'WRITE_OUTSIDE_PREPARATION');
  fs.mkdirSync(dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes, { flag: 'wx' });
}
export const save = (filename, value) => write(filename, JSON.stringify(value, null, 2) + '\n');
export function inventory(root, { allowEmpty = false } = {}) {
  const result = [];
  const visit = prefix => {
    for (const name of fs.readdirSync(resolve(root, prefix)).sort()) {
      const path = safe(prefix ? `${prefix}/${name}` : name), target = resolve(root, path), stat = fs.lstatSync(target);
      assert.ok(!stat.isSymbolicLink(), `SYMLINK:${path}`);
      if (stat.isDirectory()) { assert.ok(allowEmpty || fs.readdirSync(target).length > 0, `UNLISTED_EMPTY_DIRECTORY:${path}`); visit(path); }
      else { assert.ok(stat.isFile(), `NONREGULAR:${path}`); result.push({ path, mode: stat.mode & 511, bytes: stat.size, sha256: fileHash(target) }); }
    }
  };
  visit(''); return result;
}
export function sameInventory(actual, expected) {
  const normalize = rows => rows.map(row => ({ path: safe(row.path), mode: typeof row.mode === 'string' ? parseInt(row.mode, 8) & 511 : row.mode, bytes: row.bytes, sha256: row.sha256 })).sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(normalize(actual), normalize(expected), 'COMPLETE_FRESH_INVENTORY');
}
export function authenticatePreparation(expected) {
  assert.equal(fileHash(resolve(freeze, 'MANIFEST.json')), freezeHash, 'ORIGINAL_FREEZE');
  const frozen = read(resolve(freeze, 'MANIFEST.json'));
  for (const row of frozen.files) assert.equal(fileHash(resolve(freeze, safe(row.path))), row.sha256, 'ORIGINAL_FREEZE_FILE');
  const binding = read(resolve(freeze, 'BINDINGS.json'));
  const supplemental = read(resolve(recipe, '../public-candidate-execution-v1/AUTHOR-BINDINGS.json'));
  binding.protectedFiles.push(...read(resolve(recipe,'CONTINUATION.json')).protectedFiles);
  binding.selectedInputs.push(...supplemental.additionalBuildInputs);
  binding.protectedFiles.push(...supplemental.protectedFiles);
  for (const row of binding.tools) assert.equal(fileHash(row.path), row.sha256, 'PRE_RUN_TOOL');
  assert.equal(process.execPath, node); assert.equal(process.version, 'v22.22.2');
  assert.equal(fileHash(resolve(recipe, 'MANIFEST.json')), expected, 'PREPARATION_MANIFEST');
  const manifest = read(resolve(recipe, 'MANIFEST.json'));
  for (const row of [...manifest.files, ...manifest.references]) {
    const target = row.repositoryRelative ? resolve(repository, safe(row.path)) : resolve(recipe, safe(row.path));
    assert.ok(fs.lstatSync(target).isFile()); assert.equal(fileHash(target), row.sha256, `RECIPE_FILE:${row.path}`);
  }
  for (const row of binding.protectedFiles) assert.equal(fileHash(resolve(repository, safe(row.path))), row.sha256, 'HISTORICAL_PROTECTED');
  return { binding, manifest };
}
export const relativeOwned = filename => relative(recipe, filename);
export function reason(error) { return { name: error?.name, code: error?.code, message: String(error?.message ?? error), stack: error?.stack }; }
