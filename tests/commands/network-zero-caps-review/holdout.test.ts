import assert from 'node:assert/strict';
import test from 'node:test';
import * as root from '../../../src/index.js';
import * as network from '../../../src/commands/network/index.js';
import { runSuite } from './runtime.mjs';
import { runMutations } from './mutations.mjs';

test('independent zero-cap contract through direct and Shell/plugin public execution', { timeout: 30000 }, async () => {
  const result = await runSuite(root, network);
  assert.equal(result.counts.skipped, 0);
  assert.equal(result.counts.failed, 0, JSON.stringify(result.receipts.filter(receipt => receipt.pass === false)));
  assertOffline();
});

test('independent holdout detects zero acceptance, enforcement and cleanup mutations', { timeout: 15000 }, async () => {
  const result = await runMutations(root, network);
  assert.equal(result.detected, result.mutations);
  assertOffline();
});
import { assertOffline } from './offline.mjs';
