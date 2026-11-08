import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLimits } from './contracts.js';
import { createFoldEngine } from './engine.js';
test('fold admits unlimited quotas without coupling decoded bytes to explicit input bytes', () => {
  const limits = { inputBytes: 10, outputBytes: Infinity, retainedBytes: Infinity, work: Infinity, argumentBytes: Infinity };
  validateLimits(limits);
  const engine = createFoldEngine({ files: [], width: 80, mode: 'bytes', spaces: false }, 'C', limits);
  try { assert.ok(engine); } finally { engine.dispose(); }
});
