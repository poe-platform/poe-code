import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createUploadServer } from './server.js';
import { createUploadClient } from './uploads.js';

it.each([false, true])('bounds concurrent abort cleanup and drains queued removals after failure: %s', async fail => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let active = 0;
  let peak = 0;
  let failed = false;
  const failure = new Error('remove failed');
  const remove = vi.fn(async (id: string) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await gate;
      if (fail && id === ids[0] && !failed) { failed = true; throw failure; }
    } finally { active--; }
  });
  const server = createUploadServer({
    now: () => 0,
    authenticate: async () => ({ tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 1000, sessionExpiresAt: 1000 }),
    storage: { append: async () => {}, read: async () => new Uint8Array(), remove },
    limits: { maxBlobBytes: 0n, maxReservedBytes: 0n, maxChunkBytes: 1, maxConcurrent: 2, maxUploads: 5, maxChunks: 1 },
  });
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 1,
    // Admit all four client retirements to exercise the server's two-lane queue.
    maxConcurrentUploads: 4, fetch: async (url, init) => server.fetch(new Request(url, init)),
  });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await client.beginUpload({ size: '0', digest: createHash('sha256').digest('hex') })).uploadId);
  const outcomes: Promise<unknown>[] = [];
  const controller = new AbortController();
  const reason = new Error('caller left during queued cleanup');
  try {
    for (let i = 0; i < 4; i++) {
      outcomes.push(client.abortUpload(ids[i], i === 2 ? controller.signal : undefined).catch(error => error));
      // Await another authenticated operation to let each abort enter retirement.
      await client.inspectUpload(ids[4]);
    }
    expect(active).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
    controller.abort(reason);
    await client.inspectUpload(ids[4]);
    expect(remove).toHaveBeenCalledTimes(2);
  } finally {
    release();
    await Promise.all(outcomes);
  }
  expect(peak).toBe(2);
  expect(active).toBe(0);
  expect(remove.mock.calls.map(([id]) => id).sort()).toEqual(ids.slice(0, 4).sort());
  expect(await outcomes[2]).toBe(reason);
  expect(await client.inspectUpload(ids[2])).toMatchObject({ state: 'aborted' });
  if (fail) {
    expect(await outcomes[0]).toMatchObject({ status: 503 });
    await server.sweep();
    expect(remove).toHaveBeenCalledTimes(5);
  } else expect(await outcomes[0]).toMatchObject({ state: 'aborted' });
  await server.close();
});
