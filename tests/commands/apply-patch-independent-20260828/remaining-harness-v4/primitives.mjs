import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function describe(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  assert.ok(stat.size <= 256 * 1024 * 1024);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const digest = crypto.createHash('sha256');
  const chunk = Buffer.alloc(65536);
  let total = 0;
  try {
    assert.equal(fs.fstatSync(descriptor).ino, stat.ino);
    for (;;) {
      const length = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (!length) break;
      total += length;
      assert.ok(total <= stat.size);
      digest.update(chunk.subarray(0, length));
    }
    assert.equal(total, stat.size);
  } finally { fs.closeSync(descriptor); }
  return { bytes: total, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
export function authenticate(filename, expectedBytes, mode) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'regular file required');
  assert.equal(stat.nlink, 1, 'alias refused');
  assert.equal(stat.mode & 0o777, mode, 'mode refused');
  assert.equal(stat.size, expectedBytes.length, 'length refused');
  assert.equal(fs.realpathSync(filename), filename, 'remapped ancestor refused');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, stat.ino);
    assert.equal(opened.dev, stat.dev);
    assert.equal(opened.nlink, 1);
    const bytes = Buffer.alloc(expectedBytes.length);
    assert.equal(fs.readSync(descriptor, bytes, 0, bytes.length, 0), bytes.length);
    assert.deepEqual(bytes, expectedBytes, 'bytes refused');
    assert.equal(fs.fstatSync(descriptor).size, bytes.length);
  } finally { fs.closeSync(descriptor); }
  return describe(filename);
}
export function inventory(directory) {
  const entries = [];
  let total = 0;
  function walk(relative, depth) {
    assert.ok(depth <= 10);
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      assert.ok(entries.length < 128);
      const key = relative ? `${relative}/${name}` : name;
      const filename = path.join(directory, key);
      const stat = fs.lstatSync(filename);
      const base = { path: key, mode: stat.mode & 0o777, nlink: stat.nlink };
      if (stat.isDirectory()) {
        entries.push({ ...base, kind: 'directory' });
        walk(key, depth + 1);
      } else if (stat.isSymbolicLink()) entries.push({ ...base, kind: 'symlink', target: fs.readlinkSync(filename) });
      else {
        assert.ok(stat.isFile());
        total += stat.size;
        assert.ok(total <= 1024 * 1024);
        entries.push({ ...base, kind: 'file', ...describe(filename) });
      }
    }
  }
  walk('', 0);
  return { entries, bytes: total };
}
