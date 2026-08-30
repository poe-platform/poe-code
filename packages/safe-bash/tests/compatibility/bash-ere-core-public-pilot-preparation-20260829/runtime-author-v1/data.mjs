import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function read(file, maximum = 4 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'regular bounded input');
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, stat.size);
  return bytes;
}
export function bind(row) {
  const stat = fs.lstatSync(row.path);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, row.size); assert.equal(stat.mode & 0o777, row.mode);
  const descriptor = fs.openSync(row.path, 'r');
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.alloc(65536);
  try { const opened = fs.fstatSync(descriptor); assert.equal(opened.dev, stat.dev); assert.equal(opened.ino, stat.ino); let count; while ((count = fs.readSync(descriptor, buffer))) digest.update(buffer.subarray(0, count)); } finally { fs.closeSync(descriptor); }
  assert.equal(digest.digest('hex'), row.sha256, row.path);
}
export function archiveAdmission(row, bytes) {
  assert.equal(row.size, 909885); assert.equal(bytes.length, row.size);
  assert.equal(row.sha256, 'fc559bb3a1bd7db72e959461ce2b733871cde0867095c61fd065021fb498606d');
  assert.equal(hash(bytes), row.sha256);
  return bytes;
}
export function census(root) {
  let bytes = 0;
  const rows = [];
  const walk = directory => { for (const name of fs.readdirSync(directory).sort()) { const file = path.join(directory, name); const stat = fs.lstatSync(file); assert(!stat.isSymbolicLink(), 'unexpected link'); if (stat.isDirectory()) { rows.push({ path: path.relative(root, file), kind: 'directory' }); walk(file); } else { assert(stat.isFile()); bytes += stat.size; assert(Number.isSafeInteger(bytes)); rows.push({ path: path.relative(root, file), kind: 'file', size: stat.size }); } } };
  walk(root);
  return Object.freeze({ bytes, rows });
}
export function verifyPackage(root, expected) {
  const actual = census(root);
  assert.deepEqual(actual.rows.filter(row => row.kind === 'file').map(row => row.path).sort(), expected.map(row => row.path).sort());
  for (const row of expected) bind({ ...row, path: path.join(root, row.path) });
  return actual;
}
export function copyRows(source, target, rows) {
  for (const row of rows) { const from = path.join(source, row.path); bind({ ...row, path: from }); const to = path.join(target, row.path); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); fs.chmodSync(to, row.mode); }
}
