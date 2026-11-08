import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const jsonHash = (value) => sha256(JSON.stringify(value));
export const readJson = (filename) => JSON.parse(readFileSync(filename, 'utf8'));

export function regularBytes(filename, maximumBytes = 67108864) {
  const metadata = lstatSync(filename);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `Not regular: ${filename}`);
  assert(metadata.size <= maximumBytes, `Oversized file: ${filename}`);
  assert.equal(realpathSync(filename), resolve(filename), `Symlink path: ${filename}`);
  return readFileSync(filename);
}

export function treeSnapshot(root) {
  assert(isAbsolute(root) && realpathSync(root) === root, 'Tree root must be canonical absolute');
  const entries = [];
  let totalBytes = 0;
  function walk(directory, prefix) {
    const metadata = lstatSync(directory);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink(), 'Regular directories only');
    entries.push({ path: prefix || '.', kind: 'directory', mode: metadata.mode & 0o7777 });
    for (const name of readdirSync(directory).sort()) {
      assert(entries.length < 40000, 'Tree entry bound');
      const filename = join(directory, name);
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(filename);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(filename, path);
      else {
        const bytes = regularBytes(filename);
        totalBytes += bytes.length;
        assert(totalBytes <= 536870912, 'Tree byte bound');
        entries.push({ path, kind: 'file', mode: stat.mode & 0o7777, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  walk(root, '');
  return entries;
}

export function inside(root, filename) {
  const suffix = relative(root, resolve(filename));
  return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix));
}

export function verifyGuards(guards) {
  assert(Array.isArray(guards) && guards.length > 0 && guards.length <= 40);
  for (const guard of guards) {
    if (guard.kind === 'file') {
      assert.equal(sha256(regularBytes(guard.path, guard.maximumBytes ?? 67108864)), guard.sha256, `File hash: ${guard.path}`);
      assert.equal(lstatSync(guard.path).mode & 0o7777, guard.mode, `File mode: ${guard.path}`);
    } else {
      assert.equal(guard.kind, 'tree');
      assert.equal(jsonHash(treeSnapshot(guard.path)), guard.sha256, `Tree membership/hash/modes: ${guard.path}`);
    }
  }
}

export function createEvidence(parent, guards) {
  assert(isAbsolute(parent) && realpathSync(parent) === parent);
  assert(lstatSync(parent).isDirectory());
  for (const guard of guards) {
    assert(!inside(guard.path, parent) && !inside(parent, guard.path), 'Evidence and guarded inputs must be disjoint');
  }
  const root = join(parent, `run-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
  mkdirSync(root, { mode: 0o700 });
  return root;
}

export function atomicWrite(filename, bytes) {
  assert(!existsSync(filename), `Refuse overwrite: ${filename}`);
  const temporary = join(dirname(filename), `.pending-${randomUUID()}`);
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(temporary, filename);
  } finally {
    unlinkSync(temporary);
  }
}

export function atomicJson(filename, value) {
  atomicWrite(filename, `${JSON.stringify(value, null, 2)}\n`);
}
