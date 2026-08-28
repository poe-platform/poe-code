import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export { durable } from '../actual-review-v1/a01.mjs';
export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const OLD = path.resolve(ROOT, '../actual-review-v1');
export const REPO = path.resolve(ROOT, '../../../..');
export const NODE = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
export async function identity(filename) {
  const stat = await lstat(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const data = await readFile(filename);
  return { bytes: data.length, sha256: hash(data), mode: (stat.mode & 0o777).toString(8).padStart(3, '0') };
}
export async function tree(root, prefix = '') {
  const entries = [];
  for (const name of (await readdir(path.join(root, prefix))).sort()) {
    const relative = prefix + name; const stat = await lstat(path.join(root, relative));
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) { entries.push({ path: relative + '/', directory: true }); entries.push(...await tree(root, relative + '/')); }
    else entries.push({ path: relative, ...await identity(path.join(root, relative)) });
  }
  return entries;
}
export async function verifyTree(root, entries) {
  const normalize = rows => [...rows].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  assert.deepEqual(normalize(await tree(root)), normalize(entries), `append-aware tree ${root}`);
}
export async function frozen() {
  const seal = await json(path.resolve(ROOT, '../preparation-v2/RECIPE-SEAL.json')); const documents = {};
  assert.equal(seal.frozenCommit, '55810d4aea70fadf151c2fbf746a17f96bfeb599');
  for (const entry of seal.inputs) {
    const raw = await readFile(path.join(REPO, entry.path)); assert.equal(raw.length, entry.bytes); assert.equal(hash(raw), entry.sha256);
    if (entry.path.endsWith('.json')) documents[entry.path.split('xan-independent-20260828/')[1]] = JSON.parse(raw);
  }
  return documents;
}
