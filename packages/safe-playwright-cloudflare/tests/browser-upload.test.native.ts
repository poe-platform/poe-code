import { expect, test } from 'vitest';
import { Miniflare } from 'miniflare';
import { buildNativeFixture, disposeNativeFixture } from './browser-native-fixture.js';

test('CLI upload supplies native filechooser filenames and binary bytes', async () => {
  const script = await buildNativeFixture(new URL('./browser-upload.test.worker.ts', import.meta.url));
  const worker = new Miniflare({ modules: true, script, compatibilityDate: '2026-07-08',
    compatibilityFlags: ['nodejs_compat'], browserRendering: { binding: 'BROWSER' } });
  try {
    await worker.ready;
    const response = await worker.dispatchFetch('http://fixture/upload');
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ received: [
      { name: 'binary-é.bin', bytes: [0, 128, 255, 10, 195, 169] },
      { name: 'empty.dat', bytes: [] },
    ] });
  } finally { await disposeNativeFixture(worker); }
});
