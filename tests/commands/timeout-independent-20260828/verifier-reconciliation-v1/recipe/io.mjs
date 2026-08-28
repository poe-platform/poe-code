import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const recipe = dirname(fileURLToPath(import.meta.url)), scope = resolve(recipe, '..'), repository = resolve(scope, '../../../..');
export const work = join(scope, 'node_modules/work'), raw = join(scope, 'raw');
export const sha = value => createHash('sha256').update(value).digest('hex');
export const read = target => JSON.parse(fs.readFileSync(target));
export const fileHash = target => sha(fs.readFileSync(target));
export const safe = value => { assert.ok(typeof value === 'string' && value && !value.startsWith('/') && !/[\\\0]/u.test(value) && !value.split('/').some(part => ['', '.', '..', 'AGENTS.md'].includes(part)), `UNSAFE_PATH:${value}`); return value; };
export function write(target, bytes) { fs.mkdirSync(dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' }); }
export const save = (target, value) => write(target, `${JSON.stringify(value, null, 2)}\n`);
export function tree(root) {
  const rows = [];
  const visit = prefix => { for (const name of fs.readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name; safe(path); const stat = fs.lstatSync(join(root, path));
    assert.ok(!stat.isSymbolicLink(), `SYMLINK:${path}`);
    if (stat.isDirectory()) visit(path); else { assert.ok(stat.isFile()); rows.push({ path, mode: stat.mode & 511, bytes: stat.size, sha256: fileHash(join(root, path)) }); }
  } };
  visit(''); return rows;
}
export function tarEntries(input, compressed = false) {
  const tar = compressed ? gunzipSync(input, { maxOutputLength: 32 * 1024 ** 2 }) : input;
  assert.ok(tar.length <= 32 * 1024 ** 2 && tar.length % 512 === 0);
  const rows = [], names = new Set(); let offset = 0, pending;
  const text = (bytes, start, count) => bytes.subarray(start, start + count).toString().replace(/\0.*$/su, '');
  const number = (bytes, start, count) => { const value = text(bytes, start, count).trim(); assert.match(value || '0', /^[0-7]+$/u); return parseInt(value || '0', 8); };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) { assert.ok(tar.subarray(offset).every(value => value === 0)); assert.ok(tar.length - offset >= 1024); offset = tar.length; break; }
    let sum = 0; for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(sum, number(header, 148, 8));
    const size = number(header, 124, 12); assert.ok(Number.isSafeInteger(size) && offset + 512 + size <= tar.length);
    const body = tar.subarray(offset + 512, offset + 512 + size), type = header[156];
    const prefix = text(header, 345, 155); let path = prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100);
    if (type === 120) {
      assert.equal(pending, undefined); pending = {};
      let position = 0; while (position < body.length) { const space = body.indexOf(32, position); assert.ok(space > position); const length = Number(body.subarray(position, space).toString()); assert.ok(Number.isSafeInteger(length) && length > space - position && position + length <= body.length); const record = body.subarray(space + 1, position + length - 1).toString(); assert.equal(body[position + length - 1], 10); const equal = record.indexOf('='); assert.ok(equal > 0); const key = record.slice(0, equal); assert.ok(['path', 'mtime', 'atime', 'ctime'].includes(key)); pending[key] = record.slice(equal + 1); position += length; }
    } else {
      assert.ok(type === 0 || type === 48, `NON_REGULAR_TAR:${type}`);
      if (pending?.path) path = pending.path; pending = undefined;
      safe(path); assert.ok(!names.has(path), `DUPLICATE:${path}`); names.add(path);
      assert.equal(text(header, 157, 100), ''); const mode = number(header, 100, 8); assert.ok(mode === 420 || mode === 493);
      rows.push({ path, mode, bytes: size, sha256: sha(body), body: Buffer.from(body) });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(offset, tar.length); assert.equal(pending, undefined); return rows;
}
export function matchInventory(rows, expected) {
  const clean = input => input.map(({ path, mode, bytes, sha256 }) => ({ path, mode: typeof mode === 'string' ? parseInt(mode, 8) & 511 : mode, bytes, sha256 })).sort((first, second) => first.path.localeCompare(second.path));
  assert.deepEqual(clean(rows), clean(expected), 'COMPLETE_PINNED_INVENTORY');
}
