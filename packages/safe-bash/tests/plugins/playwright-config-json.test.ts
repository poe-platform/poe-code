import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlaywrightConfigJSON } from '../../src/playwright/config-json.js';
import { createPlaywrightController } from '../../src/playwright/index.js';

test('open refuses the reported 5.7 MiB object bomb without acquiring a browser', async () => {
  let acquisitions = 0;
  const controller = createPlaywrightController({ adapter: {
    browsers: { chromium: { headed: false } }, async acquire() { acquisitions++; throw new Error('unexpected acquisition'); },
  } });
  const bytes = new TextEncoder().encode('{"junk":[' + '{},'.repeat(1_900_000) + '{}]}');
  assert.equal(bytes.byteLength, 5_700_013);
  try {
    await assert.rejects(controller.run({ args: ['open', '--config=bomb.json'], env: {},
      signal: new AbortController().signal, async write() {}, async readArtifact(_path, budget) {
        assert.equal(budget, 128 * 1024); return bytes;
      },
    }), /configuration byte limit/);
    assert.equal(acquisitions, 0);
  } finally { await controller.dispose(); }
});

test('config admission preserves supported arrays, escaped keys, strings and native values', () => {
  const config = { browser: { initScript: ['a.js'], initPage: ['a.cjs'], contextOptions: {
    permissions: ['clipboard-read'], extraHTTPHeaders: { 'x-test': '[]{}:,"\\' },
    storageState: { cookies: [], origins: [{ origin: 'https://example.test', localStorage: [{ name: 'a', value: 'b' }] }] },
  } }, network: { allowedOrigins: ['https://example.test'], blockedOrigins: [] }, outputMaxSize: 1e3 };
  assert.deepEqual(parsePlaywrightConfigJSON(JSON.stringify(config)), config);
  assert.deepEqual(parsePlaywrightConfigJSON('{"brow\\u0073er":{}}'), { browser: {} });
});

test('config admission counts duplicate properties and primitive array entries before graph parsing', () => {
  for (const source of [
    '{' + '"browser":{},'.repeat(2100) + '"browser":{}}',
    '{"browser":{"contextOptions":{"permissions":[' + 'null,'.repeat(4096) + 'null]}}}',
    '{"browser":' + '{"x":'.repeat(32) + '0' + '}'.repeat(32) + '}',
  ]) assert.throws(() => parsePlaywrightConfigJSON(source), /structure limit/);
});

test('config admission refuses prohibited arrays and unknown escaped top-level keys', () => {
  for (const source of ['[]', '{"browser":[]}', '{"outputDir":[]}', '{"browser":{"contextOptions":{"viewport":[]}}}', '{"browser":{"contextOptions":{"permissions":[[]]}}}', '{"network":{"allowedOrigins":[[]]}}', '{"ju\\u006ek":[]}']) {
    assert.throws(() => parsePlaywrightConfigJSON(source), /configuration/);
  }
});

test('config admission retains strict JSON syntax validation', () => {
  for (const source of ['', '{', '{"browser":{,}}', '{"browser":{},}', '{"browser":{} } false', '{"browser":"unterminated}', '{"outputDir":"\\q"}', '{"outputMaxSize":NaN}']) {
    assert.throws(() => parsePlaywrightConfigJSON(source));
  }
});
