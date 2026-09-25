import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFmtLimits, validateFmtLimits } from './contracts.js';
import { parseFmtArguments } from './arguments.js';
test('fmt omitted quotas are unlimited and individual quotas remain independent', () => {
  for (const value of Object.values(defaultFmtLimits)) assert.equal(value, Infinity);
  const path = new TextEncoder().encode('a'.repeat(65537));
  assert.equal(parseFmtArguments([path]).files.length, 1);
  assert.throws(() => parseFmtArguments([path], { limits: { ...defaultFmtLimits, argumentBytes: 65536 } }), /limit/i);
  validateFmtLimits({ ...defaultFmtLimits, outputBytes: 0 });
});
