import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { sha256 } from './support.mjs';

const string = bytes => bytes.toString('utf8').replace(/\0.*$/su, '');
const octal = bytes => { const text = string(bytes).trim(); assert.match(text, /^[0-7]*$/u); return text ? Number.parseInt(text, 8) : 0; };
export function inspectTar(input, { compressed = false, prefix = '' } = {}) {
  const tar = compressed ? gunzipSync(input, { maxOutputLength: 64 * 1024 * 1024 }) : input;
  const files = {}; const entries = []; const directories = new Set(); let pending = {}; let ended = false;
  for (let offset = 0; offset < tar.length; offset += 512) {
    const header = tar.subarray(offset, offset + 512); assert.equal(header.length, 512);
    if (header.every(byte => byte === 0)) { assert.ok(tar.subarray(offset).every(byte => byte === 0)); ended = true; break; }
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, octal(header.subarray(148, 156)), 'Tar checksum');
    const type = string(header.subarray(156, 157)) || '0';
    const size = octal(header.subarray(124, 136)); assert.ok(size <= 64 * 1024 * 1024);
    const data = tar.subarray(offset + 512, offset + 512 + size); assert.equal(data.length, size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      const attributes = {}; let cursor = 0;
      while (cursor < data.length) {
        const space = data.indexOf(32, cursor); assert.ok(space > cursor);
        const length = Number(data.subarray(cursor, space).toString()); assert.ok(Number.isSafeInteger(length) && length > space - cursor && cursor + length <= data.length);
        const record = data.subarray(space + 1, cursor + length); assert.equal(record.at(-1), 10);
        const text = record.subarray(0, -1).toString(); const equals = text.indexOf('='); assert.ok(equals > 0);
        const key = text.slice(0, equals); assert.ok(['path', 'size', 'mtime', 'atime', 'ctime', 'comment'].includes(key), 'Unsupported PAX key: ' + key);
        assert.ok(!Object.hasOwn(attributes, key)); attributes[key] = text.slice(equals + 1); cursor += length;
      }
      if (type === 'g') assert.ok(Object.keys(attributes).every(key => key === 'comment'), 'No inherited global PAX paths');
      else { assert.equal(Object.keys(pending).length, 0); pending = attributes; }
      continue;
    }
    assert.ok(type === '0' || type === '5', 'Unsafe/unsupported tar entry type: ' + type);
    assert.equal(string(header.subarray(157, 257)), '', 'No links');
    const parent = string(header.subarray(345, 500));
    const name = pending.path ?? (parent ? parent + '/' : '') + string(header.subarray(0, 100));
    if (pending.size !== undefined) assert.equal(Number(pending.size), size);
    pending = {};
    assert.ok(name && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !/^[A-Za-z]:/u.test(name));
    const pieces = name.replace(/\/$/u, '').split('/'); assert.ok(pieces.every(piece => piece && piece !== '.' && piece !== '..'));
    assert.ok(!prefix || name.startsWith(prefix), 'Tar path outside declared prefix: ' + name);
    const key = name.replace(/\/$/u, ''); assert.ok(!directories.has(key) && !Object.hasOwn(files, key), 'Duplicate tar path: ' + key);
    for (let count = 1; count < pieces.length; count++) assert.ok(!Object.hasOwn(files, pieces.slice(0, count).join('/')), 'Tar file ancestor');
    const mode = octal(header.subarray(100, 108));
    if (type === '5') { assert.equal(size, 0); directories.add(key); }
    else files[key] = { sha256: sha256(data), size, mode, data: Buffer.from(data) };
    entries.push({ name, type, size, mode, ...(type === '0' ? { sha256: files[key].sha256 } : {}) });
  }
  assert.ok(ended, 'Tar end marker'); assert.equal(Object.keys(pending).length, 0, 'Unconsumed PAX');
  return { files, entries, uncompressedSha256: sha256(tar) };
}
