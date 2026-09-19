import { test } from 'vitest';
import assert from 'node:assert/strict';
import { bytesRepr } from './python-text.js';

test('database blob CSV cells preserve CPython bytes str representation', () => {
  assert.equal(bytesRepr(Uint8Array.from([0, 9, 10, 13, 31, 32, 39, 92, 127, 255])), 'b"\\x00\\t\\n\\r\\x1f \'\\\\\\x7f\\xff"');
  assert.equal(bytesRepr(new TextEncoder().encode("'\"")), 'b\'\\\'"\'');
  assert.equal(bytesRepr(new Uint8Array()), "b''");
});
