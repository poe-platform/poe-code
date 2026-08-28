import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { sha } from './common.mjs';

export function referencePackage(encoded, binding, expected) {
  assert.equal(sha(encoded), binding.captureEncodedSha256);
  const document = gunzipSync(Buffer.from(encoded.toString('utf8'), 'base64'), { maxOutputLength: 4 * 1024 * 1024 });
  assert.equal(sha(document), binding.captureDecodedSha256);
  const evidence = JSON.parse(document);
  const archive = Buffer.from(evidence.pack.base64, 'base64');
  assert.equal(archive.length, binding.tarballClaim.bytes); assert.equal(sha(archive), binding.tarballClaim.sha256);
  const tar = gunzipSync(archive, { maxOutputLength: 16 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  let ended = false;
  const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)));
  const octal = bytes => { const value = text(bytes).trim(); assert.match(value, /^[0-7]+$/); return Number.parseInt(value, 8); };
  while (offset < tar.length) {
    assert.ok(offset + 512 <= tar.length);
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) { ended = true; assert.ok(tar.subarray(offset).every(byte => byte === 0)); break; }
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(sum, octal(header.subarray(148, 156)));
    const prefix = text(header.subarray(345, 500));
    const name = (prefix ? prefix + '/' : '') + text(header.subarray(0, 100));
    assert.ok(name.startsWith('package/') && name.split('/').every(part => part !== '..' && part !== '.'));
    assert.ok(header[156] === 48 || header[156] === 0, `reference archive regular-only member ${name}`);
    const relative = name.slice(8); assert.ok(relative.length && !relative.endsWith('/') && !files.has(relative));
    const size = octal(header.subarray(124, 136)); assert.ok(size <= 8 * 1024 * 1024 && offset + size <= tar.length);
    const bytes = Buffer.from(tar.subarray(offset, offset + size)); offset += Math.ceil(size / 512) * 512;
    const entry = expected[relative]; assert.ok(entry?.kind === 'file', relative);
    assert.equal(bytes.length, entry.bytes, relative); assert.equal(sha(bytes), entry.sha256, relative); assert.equal(octal(header.subarray(100, 108)) & 0o777, entry.mode, relative);
    files.set(relative, bytes); assert.ok(files.size <= 882);
  }
  assert.ok(ended); assert.equal(files.size, 882);
  assert.deepEqual([...files.keys()].sort(), Object.keys(expected).filter(name => expected[name].kind === 'file').sort());
  return { files, archive };
}
