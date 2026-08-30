import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function captureTree(root) {
  const entries = [];
  function visit(path) {
    const file = path === '.' ? root : join(root, path), before = lstatSync(file);
    const mode = before.mode & 0o7777;
    if (before.isSymbolicLink()) {
      assert.notEqual(path, '.', 'protected root must not be a symlink');
      entries.push({ path, kind: 'symlink', mode, target: readlinkSync(file) });
    } else if (before.isDirectory()) {
      entries.push({ path, kind: 'directory', mode });
      for (const name of readdirSync(file).sort()) visit(path === '.' ? name : `${path}/${name}`);
    } else {
      assert.ok(before.isFile(), `unsupported protected entry: ${path}`);
      const bytes = readFileSync(file), after = lstatSync(file);
      assert.ok(after.isFile() && after.ino === before.ino && after.dev === before.dev && after.size === before.size && after.mtimeMs === before.mtimeMs && after.mode === before.mode, `entry changed during inventory: ${path}`);
      entries.push({ path, kind: 'file', mode, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  assert.ok(lstatSync(root).isDirectory(), 'protected root must be a directory');
  visit('.');
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { format: 'protected-tree-v1', entries, sha256: hash(JSON.stringify(entries)) };
}
export function compareTrees(before, after) {
  assert.equal(before.format, 'protected-tree-v1'); assert.equal(after.format, before.format);
  const expected = new Map(before.entries.map(entry => [entry.path, entry]));
  const observed = new Map(after.entries.map(entry => [entry.path, entry]));
  assert.equal(expected.size, before.entries.length); assert.equal(observed.size, after.entries.length);
  const changes = [];
  for (const path of [...new Set([...expected.keys(), ...observed.keys()])].sort()) {
    if (!expected.has(path)) changes.push({ path, kind: 'added', after: observed.get(path) });
    else if (!observed.has(path)) changes.push({ path, kind: 'removed', before: expected.get(path) });
    else if (JSON.stringify(expected.get(path)) !== JSON.stringify(observed.get(path))) changes.push({ path, kind: 'changed', before: expected.get(path), after: observed.get(path) });
  }
  return changes;
}
export function createTreeGuard(root) {
  const path = resolve(root), serialized = JSON.stringify(captureTree(path));
  return Object.freeze({ root: path, before: () => JSON.parse(serialized), check() {
    try { const after = captureTree(path); return { after, changes: compareTrees(JSON.parse(serialized), after) }; }
    catch (error) { return { changes: [{ path: '.', kind: 'unreadable', error: error.message }] }; }
  } });
}
