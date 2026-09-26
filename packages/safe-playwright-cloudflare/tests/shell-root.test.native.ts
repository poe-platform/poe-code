import { expect, test } from 'vitest';
import { Miniflare } from 'miniflare';
import { buildNativeFixture, disposeNativeFixture } from './browser-native-fixture.js';

test('public root imports and retained shell cleanup work across Worker requests', async () => {
  const script = await buildNativeFixture(new URL('./shell-root.test.worker.ts', import.meta.url));
  const worker = new Miniflare({ modules: true, script, compatibilityDate: '2026-07-08',
    compatibilityFlags: ['nodejs_compat'] });
  async function request(route: string, expected: object) {
    const response = await worker.dispatchFetch('http://fixture' + route);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual(expected);
  }
  try {
    await worker.ready;
    await request('/run', { runs: 1, output: '10\n' });
    await request('/cancel-awk', { cancelled: true });
    await request('/run', { runs: 2, output: '10\n' });
    await request('/cancel-jq', { cancelled: true });
    await request('/run', { runs: 3, output: '10\n' });
    await request('/dispose', { disposed: true });
  } finally { await disposeNativeFixture(worker); }
});
