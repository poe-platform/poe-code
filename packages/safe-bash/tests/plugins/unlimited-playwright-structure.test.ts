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
for (const maxArtifactBytes of [Infinity, 1]) test(`element screenshots omit pixel budgets with artifact limit ${maxArtifactBytes}`, async () => {
  let captures = 0;
  const target = { async boundingBox() { return { x: 0, y: 0, width: 2001, height: 2000 }; },
    async screenshot() { captures++; return Uint8Array.of(1); } } as PlaywrightElementHandle;
  const options = { type: 'png' as const, scale: 'css' as const, timeout: 5000, maxArtifactBytes, signal: new AbortController().signal };
  assert.deepEqual(await capturePlaywrightTargetScreenshot(target, options), Uint8Array.of(1));
  await assert.rejects(capturePlaywrightTargetScreenshot(target, { ...options, maxPixels: 4_000_000 }), /pixel limit/);
  assert.equal(captures, 1);
});

import { validatePlaywrightSessionName } from '../../src/playwright/invocation.js';
test('session names have no implicit length ceiling', () => {
  assert.doesNotThrow(() => validatePlaywrightSessionName('s'.repeat(129)));
  assert.throws(() => validatePlaywrightSessionName('s'.repeat(129), 128), /session name/);
});
import { updatePlaywrightHighlight } from '../../src/playwright/highlight.js';
import type { PlaywrightPage } from '../../src/playwright/adapter.js';
test('highlights admit more than 128 targets with unlimited budgets', async t => {
  const key = Symbol.for('safe-bash.playwright.highlights');
  const saved = Object.getOwnPropertyDescriptor(globalThis, key);
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const overlay = { style: {}, setAttribute() {}, remove() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => overlay, documentElement: { appendChild() {} } } });
  const entries = new Map(Array.from({length:128},()=>[{}, {overlay}]));
  Reflect.set(globalThis,key,{entries,refresh() {}});
  t.after(()=>{ if(saved)Object.defineProperty(globalThis,key,saved);else Reflect.deleteProperty(globalThis,key);if(document)Object.defineProperty(globalThis,'document',document);else Reflect.deleteProperty(globalThis,'document'); });
  const target = { async evaluate(callback: (node: unknown, input: unknown)=>unknown,input: unknown) {return callback({isConnected:true},JSON.parse(JSON.stringify(input)));} } as unknown as PlaywrightElementHandle;
  await updatePlaywrightHighlight({} as PlaywrightPage,target,{hide:false});
  assert.equal(entries.size,129);
  await assert.rejects(updatePlaywrightHighlight({} as PlaywrightPage,target,{hide:false,maxEntries:128}),/retention limit/);
});
