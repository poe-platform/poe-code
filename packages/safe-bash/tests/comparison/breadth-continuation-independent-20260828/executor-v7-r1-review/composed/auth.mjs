import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const home = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(home, '../../../../..');
export const candidateRoot = path.resolve(home, '../../../breadth-continuation-20260828/executor-v7-r1');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function hashFile(filename) {
  const hasher = createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  const buffer = Buffer.alloc(65536);
  try {
    for (let amount; (amount = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0;) hasher.update(buffer.subarray(0, amount));
  } finally { fs.closeSync(descriptor); }
  return hasher.digest('hex');
}
export function authenticate() {
  const seal = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
  const bindings = JSON.parse(fs.readFileSync(path.join(home, 'INPUTS.json')));
  const checks = [];
  for (const entry of [...bindings.files, ...seal.owned]) {
    const filename = entry.base === 'owned' ? path.join(home, entry.path) : path.resolve(candidateRoot, entry.path);
    const info = fs.lstatSync(filename);
    const observed = { bytes: info.size, mode: info.mode & 0o7777, sha256: hashFile(filename) };
    assert.ok(info.isFile() && !info.isSymbolicLink(), entry.path);
    assert.deepEqual(observed, { bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256 }, entry.path);
    checks.push({ path: entry.path, ...observed });
  }
  const namespaces = [];
  for (const namespace of bindings.namespaces) {
    const found = [];
    const walk = relative => {
      for (const name of fs.readdirSync(path.resolve(candidateRoot, namespace.path, relative)).sort()) {
        const member = path.join(relative, name);
        const info = fs.lstatSync(path.resolve(candidateRoot, namespace.path, member));
        assert.equal(info.isSymbolicLink(), false);
        found.push({ path: member, directory: info.isDirectory() });
        if (info.isDirectory() && !namespace.excludedDescendants.includes(member)) walk(member);
      }
    };
    walk('');
    const normalize = entries => entries.map(({ path: member, directory }) => ({ path: member, directory })).sort((left, right) => left.path.localeCompare(right.path));
    assert.deepEqual(normalize(found), normalize(namespace.entries));
    namespaces.push({ path: namespace.path, entries: found.length, newEntriesChecked: true, excludedDescendants: namespace.excludedDescendants });
  }
  return { sealSha256: hashFile(path.join(home, 'PRESEAL.json')), recipeInputs: bindings.recipeInputs, checks, namespaces };
}
