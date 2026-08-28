import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const repository = '/Users/kjopek/Workspace/safe-bash';
export const base = 'tests/commands/yq-independent-20260828';
export const owned = join(repository, base, 'actual-35da1854-v1');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
export const git = (args, input) => execFileSync('/usr/bin/git', args, { cwd: repository, input, timeout: 60000, maxBuffer: 134217728 });

export function fileRecord(path) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, path);
  assert.equal(realpathSync(path), resolve(path));
  const bytes = readFileSync(path);
  return { sha256: sha256(bytes), bytes: bytes.length, mode: stat.mode & 0o7777 };
}

export function snapshot(root, historicalData = false) {
  assert.equal(realpathSync(root), resolve(root));
  const entries = [];
  function visit(path, relative) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      assert(historicalData, path);
      entries.push({ path: relative, kind: 'historical-symlink-not-followed', mode: stat.mode & 0o7777, target: readlinkSync(path) });
      return;
    }
    assert(entries.length < 30000, 'Bounded tree inventory');
    if (stat.isDirectory()) {
      entries.push({ path: relative || '.', kind: 'directory', mode: stat.mode & 0o7777 });
      for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name);
    } else entries.push({ path: relative, kind: 'file', ...fileRecord(path) });
  }
  visit(root, '');
  return entries;
}

export function gitEntries(commit, path) {
  assert(/^[a-f0-9]{40}$/.test(commit));
  assert.equal(git(['rev-parse', `${commit}^{commit}`]).toString().trim(), commit);
  const entries = git(['ls-tree', '-rz', commit, '--', path]).toString().split('\0').filter(Boolean).map((line) => {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
    assert(match, line);
    assert(['100644', '100755'].includes(match[1]));
    return { commit, path: match[3], blob: match[2], mode: match[1] === '100755' ? 0o755 : 0o644 };
  });
  assert(entries.length > 0, path);
  return entries;
}

export function authenticate(entries, live = true) {
  const output = git(['cat-file', '--batch'], entries.map((entry) => `${entry.blob}\n`).join(''));
  let offset = 0;
  return entries.map((entry) => {
    const end = output.indexOf(10, offset);
    const header = output.subarray(offset, end).toString().split(' ');
    assert.equal(header[0], entry.blob);
    assert.equal(header[1], 'blob');
    const count = Number(header[2]);
    const bytes = output.subarray(end + 1, end + 1 + count);
    offset = end + count + 2;
    const result = { ...entry, sha256: sha256(bytes), bytes: count };
    if (live) {
      const actual = fileRecord(join(repository, entry.path));
      assert.equal(actual.sha256, result.sha256, entry.path);
      assert.equal(actual.bytes, count, entry.path);
      assert.equal(Boolean(actual.mode & 0o111), Boolean(entry.mode & 0o111), entry.path);
      result.liveMode = actual.mode;
    }
    return result;
  });
}

export function checkGuards(guards) {
  for (const guard of guards) {
    const actual = guard.kind === 'tree' ? snapshot(guard.path, guard.historicalData) : fileRecord(guard.path);
    assert.equal(sha256(JSON.stringify(actual)), guard.digest, `Input membership/mode/hash: ${guard.path}`);
  }
}
