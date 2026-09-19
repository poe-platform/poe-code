import { createServer } from 'node:http';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { Miniflare } from 'miniflare';
import { buildNativeFixture } from './browser-native-fixture.js';

test('forced owner reset during outstanding POST inspects unknown outcome and recovers without replay', async () => {
  let effects = 0;
  let navigations = 0;
  let entered!: () => void;
  const outstanding = new Promise<void>(resolve => { entered = resolve; });
  const server = createServer((request, response) => {
    if (request.method === 'POST') { effects++; entered(); return; }
    if (request.url?.startsWith('/one-time?')) navigations++;
    response.end('<!doctype html><title>One time login</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing origin');
  const persistence = new URL(`../../../out/issue-112/native-${crypto.randomUUID()}/`, import.meta.url).pathname;
  const script = await buildNativeFixture(new URL('./browser-recovery.test.worker.ts', import.meta.url));
  const createWorker = () => new Miniflare({ modules: true, script, compatibilityDate: '2026-07-08',
    compatibilityFlags: ['nodejs_compat'], browserRendering: { binding: 'BROWSER' },
    kvNamespaces: ['RECOVERY'], kvPersist: persistence });
  let worker = createWorker();
  const abort = new AbortController();
  let running: Promise<unknown> | undefined;
  try {
    await worker.ready;
    running = worker.dispatchFetch('http://fixture/start', { method: 'POST', body: `http://127.0.0.1:${address.port}`, signal: abort.signal }).catch(() => {});
    await outstanding;
    expect(effects).toBe(1);
    abort.abort();
    await worker.dispose();
    worker = createWorker();
    await worker.ready;
    const expected = { name: 'owned', status: 'saved-storage', livePageStateLost: true,
      operation: { operationId: 'post-112', status: 'unknown' } };
    for (const route of ['inspect', 'inspect', 'recover', 'inspect']) {
      const response = await worker.dispatchFetch(`http://fixture/${route}`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual(expected);
      expect(text).not.toContain('never-print');
      expect(effects).toBe(1);
      expect(navigations).toBe(1);
    }
  } finally {
    abort.abort();
    await worker.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await running;
    await rm(persistence, { recursive: true, force: true });
  }
}, 30000);
