import assert from 'node:assert/strict';
import test from 'node:test';
import { Budget } from './contracts.js';
test('unrtf omitted quotas are unlimited and individual quotas stay independent', () => {
  const budget = new Budget({ signal: new AbortController().signal, limits: { outputBytes: 0 } });
  budget.charge('inputBytes', 16_777_217, 0);
  assert.throws(() => budget.charge('outputBytes', 1, 0), /limit/i);
});
