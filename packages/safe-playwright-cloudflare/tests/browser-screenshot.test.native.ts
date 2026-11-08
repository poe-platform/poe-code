import { expect, test } from 'vitest';
import { Miniflare } from 'miniflare';
import { transform } from 'esbuild';
import { buildNativeFixture } from './browser-native-fixture';

test('identifier-minified Worker captures a full-page screenshot and releases its browser', async () => {
  const source = await buildNativeFixture(new URL('./browser-screenshot.test.worker.ts', import.meta.url));
  const { code: script } = await transform(source, { minify: true, keepNames: true, format: 'esm', target: 'es2022' });
  const worker = new Miniflare({ modules: true, script, compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'], browserRendering: { binding: 'BROWSER' } });
  try {
    const response = await worker.dispatchFetch('http://fixture/');
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
  } finally { await worker.dispose(); }
});
