import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function describe(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `regular file: ${filename}`);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const digest = crypto.createHash('sha256');
  const chunk = Buffer.alloc(65536);
  let bytes = 0;
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev);
    for (;;) {
      const length = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (!length) break;
      bytes += length; assert.ok(bytes <= stat.size);
      digest.update(chunk.subarray(0, length));
    }
    assert.equal(bytes, stat.size);
  } finally { fs.closeSync(descriptor); }
  return { bytes, sha256: digest.digest('hex'), mode: stat.mode & 0o777 };
}
export function inventory(root, maximum = 512 * 1024 * 1024) {
  const entries = {};
  let bytes = 0;
  let count = 0;
  function walk(relative, depth) {
    assert.ok(depth <= 64);
    const names = fs.readdirSync(path.join(root, relative));
    names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    for (const name of names) {
      assert.ok(++count <= 60000);
      const key = relative ? `${relative}/${name}` : name;
      const absolute = path.join(root, key);
      const stat = fs.lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink(), `inventory symlink: ${absolute}`);
      if (stat.isDirectory()) { entries[key + '/'] = { kind: 'directory', mode: stat.mode & 0o777 }; walk(key, depth + 1); }
      else {
        assert.ok(stat.isFile()); bytes += stat.size; assert.ok(bytes <= maximum);
        entries[key] = { kind: 'file', ...describe(absolute) };
      }
    }
  }
  walk('', 0);
  return entries;
}
export function absent(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}
export function ownEqual(actual, expected) {
  if (actual === null || typeof actual !== 'object') return Object.is(actual, expected);
  if (expected === null || typeof expected !== 'object' || Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Reflect.ownKeys(expected);
  const observed = Reflect.ownKeys(actual);
  if (keys.length !== observed.length || !keys.every((key, index) => key === observed[index])) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(actual, key);
    return descriptor && Object.hasOwn(descriptor, 'value') && ownEqual(descriptor.value, expected[key]);
  });
}
