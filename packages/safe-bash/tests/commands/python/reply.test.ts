import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePythonReply } from '../../../src/commands/python/reply.js';

test('worker replies reject oversized backend strings before invoking serialization', () => {
  let serialized = false;
  const entry = { name: 'x'.repeat(1024), toJSON() { serialized = true; return 'unexpected'; } };
  assert.throws(() => encodePythonReply([entry], 64), error => typeof error === 'object' && error !== null && 'code' in error && error.code === 'EFBIG');
  assert.equal(serialized, false);
});

test('bounded reply encoding preserves byte arrays and Unicode escaping', () => {
  const value = { bytes: new Uint8Array([0, 255]), name: 'café\n😀\ud800' };
  const expected = new TextEncoder().encode(JSON.stringify({ bytes: [0, 255], name: value.name }));
  assert.deepEqual(encodePythonReply(value, expected.length), expected);
  assert.throws(() => encodePythonReply(value, expected.length - 1), { code: 'EFBIG' });
});
