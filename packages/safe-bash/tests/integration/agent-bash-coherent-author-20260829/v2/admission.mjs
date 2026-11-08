import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function admitFile(filename, expected, ceiling) {
  assert.ok(Number.isSafeInteger(ceiling) && ceiling > 0 && ceiling <= 16777216);
  assert.ok(Number.isSafeInteger(expected.bytes) && expected.bytes >= 0 && expected.bytes <= ceiling);
  assert.match(expected.sha256, /^[0-9a-f]{64}$/);
  const initial = fs.lstatSync(filename);
  assert.ok(initial.isFile() && !initial.isSymbolicLink()); assert.equal(initial.size, expected.bytes);
  if (expected.mode !== undefined) assert.equal(initial.mode & 0o777, expected.mode);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor); assert.equal(before.ino, initial.ino); assert.equal(before.dev, initial.dev); assert.equal(before.size, expected.bytes);
    const bytes = Buffer.alloc(expected.bytes); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset); assert.ok(count > 0); offset += count; }
    const after = fs.fstatSync(descriptor); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ino, before.ino);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

export function consumeAdmitted(filename, expected, ceiling, consume) {
  const authenticated = admitFile(filename, expected, ceiling);
  return consume(authenticated);
}
