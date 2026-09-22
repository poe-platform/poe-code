import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAlignmentCost } from './profile.js';
import { Diff3Error } from './index.js';

test('GNU default costly-search shortcut is explicitly outside the admitted profile', () => {
  assert.doesNotThrow(() => assertAlignmentCost(4095, 100));
  assert.throws(() => assertAlignmentCost(4096, 100), error => error instanceof Diff3Error && error.code === 'ALIGNMENT');
  assert.doesNotThrow(() => assertAlignmentCost(8191, 2 ** 24));
  assert.throws(() => assertAlignmentCost(8192, 2 ** 24), error => error instanceof Diff3Error && error.code === 'ALIGNMENT');
});
