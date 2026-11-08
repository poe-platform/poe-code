import { expect, it } from 'vitest';
import { createClient } from './client.js';
import { createUploadClient } from './uploads.js';

it('stops streaming when a retry receipt loses previously acknowledged bytes', async () => {
  let writes = 0;
  let inspected = false;
  let released = false;
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 1,
    fetch: async (_url, init) => {
      if (init?.method === 'PUT') writes++;
      else inspected = true;
      return Response.json({ uploadId: 'u', size: '4', digest: '0'.repeat(64), state: 'open',
        committedOffset: writes === 2 ? '3' : '4',
      }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'true' } });
    },
  });
  async function* source() {
    try { yield Uint8Array.of(1, 2, 3); }
    finally { released = true; }
  }
  await expect(client.upload('u', source())).rejects.toMatchObject({ status: 502 });
  expect(writes).toBe(2);
  expect(inspected).toBe(false);
  expect(released).toBe(true);
});

it.each(['size', 'digest'] as const)('rejects replacement of the streamed upload %s between acknowledgements', async field => {
  let writes = 0;
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 1,
    fetch: async (_url, init) => {
      if (init?.method === 'PUT') writes++;
      return Response.json({
        uploadId: 'u', size: '3', digest: '0'.repeat(64), state: 'open', committedOffset: String(writes),
        ...(writes >= 2 ? { [field]: field === 'size' ? '4' : 'f'.repeat(64) } : {}),
      }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } });
    },
  });
  async function* source() { yield Uint8Array.of(1, 2, 3); }
  await expect(client.upload('u', source())).rejects.toMatchObject({ status: 502 });
  expect(writes).toBe(2);
});

it.each(['size', 'digest'] as const)('rejects replacement of the streamed upload %s during final inspection', async field => {
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 1,
    fetch: async (_url, init) => Response.json({
      uploadId: 'u', size: '1', digest: '0'.repeat(64), state: 'open', committedOffset: '1',
      ...(!init?.method ? { [field]: field === 'size' ? '2' : 'f'.repeat(64) } : {}),
    }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }),
  });
  async function* source() { yield Uint8Array.of(1); }
  await expect(client.upload('u', source())).rejects.toMatchObject({ status: 502 });
});

it.each([
  { state: 'open', committedOffset: '1' },
  { state: 'aborted', committedOffset: '2' },
  { state: 'expired', committedOffset: '2' },
])('rejects streaming completion when inspected progress is lost or retired %j', async final => {
  const declaration = { uploadId: 'u', size: '2', digest: '0'.repeat(64) };
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 2,
    fetch: async (_url, init) => Response.json({ ...declaration,
      ...(init?.method === 'PUT' ? { state: 'open', committedOffset: '2' } : final),
    }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }),
  });
  async function* source() { yield Uint8Array.of(1, 2); }
  await expect(client.upload('u', source())).rejects.toMatchObject({ status: 502 });
});

it.each(['open', 'committed'] as const)('accepts retained %s progress beyond the supplied stream', async state => {
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 2,
    fetch: async (_url, init) => Response.json({
      uploadId: 'u', size: '4', digest: '0'.repeat(64), committedOffset: '4',
      state: init?.method === 'PUT' ? 'open' : state,
      ...(!init?.method && state === 'committed' ? { blobId: 'b' } : {}),
    }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'true' } }),
  });
  async function* source() { yield Uint8Array.of(1, 2); }
  await expect(client.upload('u', source())).resolves.toMatchObject({ state, committedOffset: '4' });
});

it('rejects final status that loses progress acknowledged by an identical retry', async () => {
  const client = createUploadClient({
    baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'token', maxChunkBytes: 2,
    fetch: async (_url, init) => Response.json({
      uploadId: 'u', size: '4', digest: '0'.repeat(64), state: 'open',
      committedOffset: init?.method === 'PUT' ? '4' : '2',
    }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'true' } }),
  });
  async function* source() { yield Uint8Array.of(1, 2); }
  await expect(client.upload('u', source())).rejects.toMatchObject({ status: 502 });
});

it.each(['open', 'aborted', 'expired'] as const)('rejects a verified blob ID on an %s upload in both SDKs', async state => {
  const transport: typeof fetch = async () => Response.json({
    uploadId: 'u', size: '2', digest: '0'.repeat(64), committedOffset: '1', state, blobId: 'b',
  }, { headers: { 'Execution-Epoch': 'e' } });
  const options = { baseUrl: 'https://upload.test', token: async () => 'token', fetch: transport };
  const scoped = createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 2 });
  const generic = createClient(options);
  await expect(scoped.inspectUpload('u')).rejects.toMatchObject({ status: 502 });
  await expect(generic.inspectUpload({ sessionId: 's', epoch: 'e' }, 'u')).rejects.toMatchObject({ status: 502 });
});
