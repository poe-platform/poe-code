import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlaywrightConfigJSON } from '../../src/playwright/config-json.js';
import { createPlaywrightRoutePolicyBackend } from '../../src/playwright/route-policy.js';
test('browser configuration structure has no default ceiling', () => {
  const source = '{"browser":{"contextOptions":{"permissions":[' + '"x",'.repeat(4097) + '"x"]}}}';
  assert.doesNotThrow(() => parsePlaywrightConfigJSON(source));
  assert.throws(() => parsePlaywrightConfigJSON(source, { maxConfigEntries: 4096 }), /structure limit/);
});
test('route registration has no default count or pattern length ceiling', async () => {
  const host = { ownsRequest: () => true, async admit() {}, async fetch() { return { status: 200, headers: [], body: new Uint8Array() }; } };
  const backend = createPlaywrightRoutePolicyBackend(host);
  try {
    for (let index = 0; index < 65; index++) backend.add('x'.repeat(4097) + index, async () => {}, 0);
  } finally { await backend.dispose(); }
  const limited = createPlaywrightRoutePolicyBackend(host, { maxRoutes: 1, maxPatternLength: 2 });
  try {
    assert.throws(() => limited.add('abc', async () => {}, 0), /pattern limit/);
    limited.add('x', async () => {}, 0);
    assert.throws(() => limited.add('x', async () => {}, 0), /count limit/);
  } finally { await limited.dispose(); }
});

import { admitPlaywrightProtocolFrame } from '../../src/playwright/private-target-transport.js';
import { parsePlaywrightStorageStateJson } from '../../src/playwright/storage-state.js';
test('browser protocol and storage graphs default to unlimited depth', () => {
  const protocol = '{"items":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}';
  assert.doesNotThrow(() => admitPlaywrightProtocolFrame(protocol));
  assert.throws(() => admitPlaywrightProtocolFrame(protocol, { maxGraphDepth: 64 }), /depth limit/);
  const state = JSON.stringify({ cookies: [], origins: [{ origin: 'https://example.test', localStorage: [] }] });
  assert.doesNotThrow(() => parsePlaywrightStorageStateJson(state));
  assert.throws(() => parsePlaywrightStorageStateJson(state, Infinity, { maxNodes: 1 }), /structure limit/);
});

import { capturePlaywrightTargetScreenshot } from '../../src/playwright/target-screenshot.js';
import type { PlaywrightElementHandle } from '../../src/playwright/adapter.js';
test('element screenshots admit more than four megapixels with unlimited host budgets', async () => {
  let captures = 0;
  const target = { async boundingBox() { return { x: 0, y: 0, width: 2001, height: 2000 }; },
    async screenshot() { captures++; return Uint8Array.of(1); } } as PlaywrightElementHandle;
  const options = { type: 'png' as const, scale: 'css' as const, timeout: 5000, maxArtifactBytes: Infinity, signal: new AbortController().signal };
  assert.deepEqual(await capturePlaywrightTargetScreenshot(target, options), Uint8Array.of(1));
  await assert.rejects(capturePlaywrightTargetScreenshot(target, { ...options, maxPixels: 4_000_000 }), /pixel limit/);
  assert.equal(captures, 1);
});
