import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlaywrightStorageState } from '../../src/playwright/storage-state.js';
import { playwrightStorageAbilities } from '../../src/playwright/storage-capabilities.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';

test('state-load rejects compact huge arrays before JSON.parse or native storage access', async t => {
  const bytes = new TextEncoder().encode('{"cookies":[' + '{},'.repeat(100000) + '{}],"origins":[]}');
  let parses = 0, writes = 0;
  const parse = JSON.parse;
  t.mock.method(JSON, 'parse', (...args: Parameters<typeof JSON.parse>) => { parses++; return parse(...args); });
  const request = {
    command: 'state-load', session: 'owned', args: ['state.json'], options: {},
    signal: new AbortController().signal,
    limits: { maxCommandBytes: 16 * 1024 * 1024, maxArtifactBytes: 16 * 1024 * 1024 },
    browserSession: { context: { async setStorageState() { writes++; } } },
    async readFile() { return bytes; },
  } as unknown as PlaywrightAbilityRequest;
  await assert.rejects(playwrightStorageAbilities['state-load']!.execute(request), /structure limit/);
  assert.equal(parses, 0);
  assert.equal(writes, 0);
});

test('oversized storage arrays reject before ownKeys enumeration', () => {
  let enumerations = 0;
  const cookies = new Proxy(new Array(100001), { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  assert.throws(() => parsePlaywrightStorageState({ cookies, origins: [] }), /structure limit/);
  assert.equal(enumerations, 0);
});

test('source admission handles escaped strings, nested IndexedDB values and invalid syntax', async () => {
  const { parsePlaywrightStorageStateJson } = await import('../../src/playwright/storage-state.js');
  const state = { cookies: [], origins: [{ origin: 'https://example.com', localStorage: [{ name: 'quote"\\', value: '[]{}:,\\"' }] }] };
  assert.deepEqual(parsePlaywrightStorageStateJson(JSON.stringify(state), 1048576), state);
  assert.throws(() => parsePlaywrightStorageStateJson('{"cookies":[],"origins":[],}', 1048576), SyntaxError);
});

test('source admission bounds object values, primitives and nesting before parsing', async t => {
  const { parsePlaywrightStorageStateJson } = await import('../../src/playwright/storage-state.js');
  let parses = 0;
  t.mock.method(JSON, 'parse', () => { parses++; throw new Error('must not parse'); });
  for (const source of [
    '[' + '0,'.repeat(100000) + '0]',
    '{' + '"key":{},'.repeat(100000) + '"key":{}}',
    '['.repeat(66) + ']'.repeat(66),
  ]) assert.throws(() => parsePlaywrightStorageStateJson(source, 16 * 1024 * 1024), /structure limit/);
  assert.equal(parses, 0);
});

test('array descriptor checks preserve rejection of accessors, holes and extra properties', () => {
  const cookies: unknown[] = [];
  Object.defineProperty(cookies, '0', { get() { throw new Error('must not invoke'); }, enumerable: true });
  assert.throws(() => parsePlaywrightStorageState({ cookies, origins: [] }), /accessor/);
  assert.throws(() => parsePlaywrightStorageState({ cookies: new Array(1), origins: [] }), /array/);
  assert.throws(() => parsePlaywrightStorageState({ cookies: Object.assign([], { extra: true }), origins: [] }), /property/);
});

test("source admission enforces exact UTF-8 serializedBytes against maxBytes while allowing structural overhead", async () => {
  const { parsePlaywrightStorageStateJson, parsePlaywrightStorageState } = await import("../../src/playwright/storage-state.js");
  const state = {
    cookies: [{
      name: "sid",
      value: "v".repeat(120),
      domain: "example.com",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    }],
    origins: [],
  };
  const json = JSON.stringify(state);
  const exactBytes = new TextEncoder().encode(json).byteLength;
  assert.deepEqual(parsePlaywrightStorageStateJson(json, exactBytes), state);
  assert.throws(() => parsePlaywrightStorageStateJson(json, exactBytes - 1), /byte limit exceeded/);
  assert.deepEqual(parsePlaywrightStorageState(state, { maxBytes: exactBytes }), state);
  assert.throws(() => parsePlaywrightStorageState(state, { maxBytes: exactBytes - 1 }), /byte limit exceeded/);
});

test('state-load has no implicit byte cap and enforces configured limits', async () => {
 const state = { cookies: [], origins: [{ origin: 'https://example.com', localStorage: [{ name: 'large', value: 'v'.repeat(1048577) }] }] };
 const bytes = new TextEncoder().encode(JSON.stringify(state));
 let restored: unknown;
 const request = {
 command: 'state-load', session: 'owned', args: ['state.json'], options: {},
 signal: new AbortController().signal,
 browserSession: { context: { async setStorageState(value: unknown) { restored = value; } } },
 async readFile() { return bytes; },
 } as unknown as PlaywrightAbilityRequest;
 await playwrightStorageAbilities['state-load']!.execute(request);
 assert.deepEqual(restored, state);
 await assert.rejects(playwrightStorageAbilities['state-load']!.execute({ ...request, limits: { maxCommandBytes: 1048576 } } as PlaywrightAbilityRequest), /byte limit/);
});
