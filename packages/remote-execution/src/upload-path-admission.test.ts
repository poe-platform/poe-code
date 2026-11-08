import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createUploadClient } from './uploads.js';

const session = { sessionId: 's', epoch: 'e' };

it.each(['generic', 'scoped'] as const)('rejects upload IDs that normalize into another route in the %s client', async kind => {
  const token = vi.fn(async () => 'token');
  const fetch = vi.fn(async () => Response.json({}, { headers: { 'Execution-Epoch': 'e' } }));
  const options = { baseUrl: 'https://upload.test', token, fetch };
  const generic = createClient(options);
  const scoped = createUploadClient({ ...options, ...session, maxChunkBytes: 1 });
  for (const id of ['.', '..', '', 'x'.repeat(257)]) {
    const operations = kind === 'generic'
      ? [() => generic.inspectUpload(session, id), () => generic.abortUpload(session, id, 'abort'),
        () => generic.commitUpload(session, id, 'commit'), () => generic.inspectBlob(session, id),
        () => generic.readBlobRange(session, id, 0n),
        () => generic.uploadChunk(session, id, 0n, Uint8Array.of(1), 'digest', 'chunk')]
      : [() => scoped.inspectUpload(id), () => scoped.abortUpload(id), () => scoped.commitUpload(id),
        () => scoped.inspectBlob(id), () => scoped.readBlob(id),
        () => scoped.uploadChunk(id, '0', Uint8Array.of(1))];
    for (const operation of operations) await expect(Promise.resolve().then(operation)).rejects.toThrow();
  }
  expect(token).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['generic', 'scoped'] as const)('keeps encoded separators and percent signs inside an opaque ID in the %s client', async kind => {
  const id = '../other/%2e%2e';
  const fetch = vi.fn(async () => Response.json({ blobId: id, size: '0', digest: '0'.repeat(64) },
    { headers: { 'Execution-Epoch': 'e' } }));
  const options = { baseUrl: 'https://upload.test', token: async () => 'token', fetch };
  const blob = kind === 'generic' ? await createClient(options).inspectBlob(session, id)
    : await createUploadClient({ ...options, ...session, maxChunkBytes: 1 }).inspectBlob(id);
  expect(blob.blobId).toBe(id);
  expect(String(fetch.mock.calls[0][0])).toBe('https://upload.test/v1/sessions/s/blobs/..%2Fother%2F%252e%252e');
});

it.each(['.', '..', '', 'x'.repeat(257)])('rejects a session ID that cannot be safely routed (%s)', async sessionId => {
  const token = vi.fn(async () => 'token'); const fetch = vi.fn();
  const options = { baseUrl: 'https://upload.test', token, fetch };
  expect(() => createUploadClient({ ...options, sessionId, epoch: 'e', maxChunkBytes: 1 })).toThrow();
  await expect(createClient(options).inspectUpload({ sessionId, epoch: 'e' }, 'u')).rejects.toThrow();
  expect(token).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
