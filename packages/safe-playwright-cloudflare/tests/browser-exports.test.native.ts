import {expect, test} from 'vitest';
import {Miniflare} from 'miniflare';
import {buildNativeFixture} from './browser-native-fixture';

test('Worker exports retain standard CLI help and bundled action generation', async () => {
  const script = await buildNativeFixture(new URL('./browser-exports.test.worker.ts', import.meta.url));
  const worker = new Miniflare({modules: true, script, compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat']});
  try {
    const response = await worker.dispatchFetch('http://fixture/');
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ok: true});
  }
  finally { await worker.dispose(); }
});
