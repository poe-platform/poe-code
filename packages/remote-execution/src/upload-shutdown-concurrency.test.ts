import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createUploadServer } from './server.js';
import { createUploadClient } from './uploads.js';

it('bounds shutdown storage work and attempts every removal after failures', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const firstBatch = new Promise<void>(resolve => { entered = resolve; });
  let active = 0;
  let peak = 0;
  const failure = new Error('storage unavailable');
  const remove = vi.fn(async (id: string) => {
    active++;
    peak = Math.max(peak, active);
    if (remove.mock.calls.length === 2) entered();
    try {
      await gate;
      if (id === failedId) throw failure;
    } finally { active--; }
  });
  const server = createUploadServer({
    now: () => 0,
    authenticate: async () => ({ tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 1000, sessionExpiresAt: 1000 }),
    storage: { append: async () => {}, read: async () => new Uint8Array(), remove },
    limits: { maxBlobBytes: 0n, maxReservedBytes: 0n, maxChunkBytes: 1, maxConcurrent: 2, maxUploads: 8, maxChunks: 1 },
  });
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 1,
    fetch: async (url, init) => server.fetch(new Request(url, init)),
  });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const upload = await client.beginUpload({ size: '0', digest: createHash('sha256').digest('hex') });
    ids.push(upload.uploadId);
    if (i % 2 === 0) await client.commitUpload(upload.uploadId);
  }
  const failedId = ids[0];
  const closing = server.close();
  const outcome = closing.catch(error => error);
  try {
    await firstBatch;
    expect(active).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
  } finally {
    release();
    await outcome;
  }
  expect(await outcome).toMatchObject({ errors: [failure] });
  expect(remove.mock.calls.map(([id]) => id).sort()).toEqual(ids.sort());
  expect(peak).toBe(2);
  expect(active).toBe(0);
  expect(server.close()).toBe(closing);
});
