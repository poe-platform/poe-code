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
    await request('/cancel-rg', { cancelled: true });
    await request('/run', { runs: 4, output: '10\n' });
    await request('/dispose', { disposed: true });
  } finally { await disposeNativeFixture(worker); }
});

test('retained regex workers dispose in a later Worker request after JSON output', async () => {
  const script = await buildNativeFixture(new URL('./shell-root.test.worker.ts', import.meta.url));
  const worker = new Miniflare({ modules: true, script, compatibilityDate: '2026-07-08',
    compatibilityFlags: ['nodejs_compat'] });
  async function request(route: string, expected: object) {
    const response = await worker.dispatchFetch('http://fixture' + route);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual(expected);
  }
  const elapsed = { secs: 0, nanos: 0, human: '0.000000s' };
  const stats = { elapsed, searches: 1, searches_with_match: 1, bytes_searched: 4,
    bytes_printed: 231, matched_lines: 1, matches: 1 };
  try {
    await worker.ready;
    await request('/prime', { route: '/prime' });
    await request('/prewarm', { route: '/prewarm' });
    await request('/json', { records: [
      { type: 'begin', data: { path: { text: '/search/input' } } },
      { type: 'match', data: { path: { text: '/search/input' }, lines: { text: '2\n' },
        line_number: 1, absolute_offset: 0,
        submatches: [{ match: { text: '2' }, start: 0, end: 1 }] } },
      { type: 'end', data: { path: { text: '/search/input' }, binary_offset: null, stats } },
      { type: 'summary', data: { elapsed_total: elapsed, stats } },
    ] });
    await request('/dispose', { disposed: true });
  } finally { await disposeNativeFixture(worker); }
});
