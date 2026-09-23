import assert from 'node:assert/strict';
import test from 'node:test';
import * as root from '../../../src/index.js';
import * as network from '../../../src/commands/network/index.js';
import { runSuite } from './runtime.mjs';
import { runMutations } from './mutations.mjs';

const expectedDefaults = Object.freeze({
  maxUploadBytes: Infinity, maxDownloadBytes: Infinity, maxBufferBytes: Infinity,
  maxHeaderBytes: Infinity, maxRedirects: Infinity, maxRetries: Infinity, maxUrls: Infinity, maxTimeMs: Infinity,
  maxTotalTimeMs: Infinity,
});

test('independent zero-cap contract through direct and Shell/plugin public execution', { timeout: 30000 }, async context => {
  const result = await runSuite(root, network, { expectedDefaults });
  assert.equal(result.counts.skipped, 0);
  assert.equal(result.counts.failed, 0, JSON.stringify(result.receipts.filter(receipt => receipt.pass === false)));
  assert.equal(result.counts.passed, 326);
  assert.equal(result.receipts.filter(receipt => receipt.name.split('/')[2] === 'maxTotalTimeMs').length, 24);
  context.diagnostic('326 checks: 220 constructor validations (24 maxTotalTimeMs), 106 direct/Shell executions');
  assertOffline();
});

test('independent holdout detects zero acceptance, enforcement and cleanup mutations', { timeout: 15000 }, async context => {
  const result = await runMutations(root, network, { expectedDefaults });
  assert.equal(result.detected, result.mutations);
  assert.equal(result.mutations, 7);
  assert.equal(result.executions, 14);
  context.diagnostic('7/7 mutations detected across 14 deliberately failing direct/Shell executions');
  assertOffline();
});
import { assertOffline } from './offline.mjs';
