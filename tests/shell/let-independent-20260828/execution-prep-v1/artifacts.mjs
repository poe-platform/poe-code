import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = path => JSON.parse(readFileSync(path));
export const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); };
export const git = (repository, args) => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
export function inventory(root) {
  const entries = {};
  function visit(folder) {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name), stat = lstatSync(path), key = relative(root, path);
      if (stat.isSymbolicLink()) entries[key] = { link: readlinkSync(path) };
      else if (stat.isDirectory()) visit(path);
      else { assert.ok(stat.isFile()); entries[key] = { sha256: hash(readFileSync(path)), bytes: stat.size, mode: stat.mode & 0o777 }; }
    }
  }
  visit(root); return entries;
}
export function copyRegular(source, destination) {
  for (const [name, expected] of Object.entries(inventory(source))) {
    assert.equal(expected.link, undefined, `no link copy ${name}`); assert.equal(name.split('/').includes('AGENTS.md'), false);
    const path = join(destination, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, readFileSync(join(source, name)), { flag: 'wx' }); chmodSync(path, expected.mode);
  }
}
export function packInventory(compressed) {
  assert.ok(compressed.length < 8 * 1024 * 1024);
  const bytes = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }), result = {};
  let offset = 0;
  const text = value => value.toString().split('\0')[0];
  const octal = value => { const entry = text(value).trim(); assert.match(entry, /^[0-7]+$/u); return parseInt(entry, 8); };
  while (offset + 512 <= bytes.length && bytes[offset] !== 0) {
    const header = bytes.subarray(offset, offset + 512), checksum = [...header].reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    assert.equal(checksum, octal(header.subarray(148, 156))); assert.ok(header[156] === 0 || header[156] === 48);
    assert.equal(text(header.subarray(157, 257)), ''); assert.equal(text(header.subarray(345, 500)), '');
    const path = text(header.subarray(0, 100)); assert.ok(path.startsWith('package/'));
    assert.ok(path.split('/').every(part => part && part !== '..' && part !== '.' && part !== 'AGENTS.md'));
    const name = path.slice(8), size = octal(header.subarray(124, 136)), mode = octal(header.subarray(100, 108));
    assert.equal(Object.hasOwn(result, name), false); assert.ok(offset + 512 + size <= bytes.length);
    result[name] = { sha256: hash(bytes.subarray(offset + 512, offset + 512 + size)), bytes: size, mode };
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(bytes.length - offset >= 1024); assert.ok(bytes.subarray(offset).every(value => value === 0)); return result;
}
export function assertTree(root, expected) { assert.deepEqual(inventory(root), expected, root); }
