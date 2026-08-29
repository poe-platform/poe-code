import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
export function hashRegularFile(filename) {
  assert.equal(typeof filename, 'string');
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 268435456);
  const descriptor = fs.openSync(filename, 'r');
  const digest = createHash('sha256'), buffer = Buffer.alloc(65536);
  let bytesRead = 0, largestRead = 0, readCalls = 0;
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.dev, before.dev); assert.equal(opened.ino, before.ino); assert.equal(opened.size, before.size);
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null); readCalls++;
      if (count === 0) break;
      bytesRead += count; largestRead = Math.max(largestRead, count);
      assert.ok(bytesRead <= before.size); digest.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(descriptor);
    assert.equal(bytesRead, before.size); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  } finally { fs.closeSync(descriptor); }
  return { sha256: digest.digest('hex'), bytesRead, largestRead, readCalls };
}

