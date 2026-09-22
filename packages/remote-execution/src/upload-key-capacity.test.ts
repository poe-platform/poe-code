import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createUploadServer } from './server.js';
import { createUploadClient } from './uploads.js';

function fixture() {
  const files = new Map<string, Uint8Array>();
  const server = createUploadServer({
    now: () => 0,
    authenticate: async () => ({ tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 1000, sessionExpiresAt: 1000 }),
    limits: { maxBlobBytes: 2n, maxReservedBytes: 2n, maxChunkBytes: 1, maxConcurrent: 1, maxUploads: 1, maxChunks: 2 },
    storage: {
      async append(id, offset, bytes) {
        const prefix = files.get(id) ?? new Uint8Array();
        expect(offset).toBe(BigInt(prefix.length));
        files.set(id, Uint8Array.from([...prefix, ...bytes]));
      },
      async read(id, offset, count) { return (files.get(id) ?? new Uint8Array()).slice(Number(offset), Number(offset) + count); },
      async remove(id) { files.delete(id); },
    },
  });
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 1,
    token: () => 'token', fetch: async (url, init) => server.fetch(new Request(url, init)) });
  return { client, files };
}

it('resumes every admitted chunk after incomplete finalize at the exact key limit', async () => {
  const { client } = fixture();
  const data = Uint8Array.of(1, 2);
  const upload = await client.beginUpload({ size: '2', digest: createHash('sha256').update(data).digest('hex') });
  await expect(client.commitUpload(upload.uploadId, undefined, 'finalize')).rejects.toMatchObject({ status: 409 });
  for (let offset = 0; offset < data.length; offset++) {
    expect(await client.uploadChunk(upload.uploadId, String(offset), data.slice(offset, offset + 1), undefined, `chunk-${offset}`))
      .toMatchObject({ committedOffset: String(offset + 1), replayed: false });
  }
  const blob = await client.commitUpload(upload.uploadId, undefined, 'finalize');
  expect(new Uint8Array(await (await client.readBlob(blob.blobId)).arrayBuffer())).toEqual(data);
});

it('bounds extra finalize keys and preserves abort capacity', async () => {
  const { client, files } = fixture();
  const upload = await client.beginUpload({ size: '2', digest: '0'.repeat(64) });
  await expect(client.commitUpload(upload.uploadId, undefined, 'finalize')).rejects.toMatchObject({ status: 409 });
  await client.uploadChunk(upload.uploadId, '0', Uint8Array.of(1), undefined, 'first');
  await expect(client.commitUpload(upload.uploadId, undefined, 'another-finalize')).rejects.toMatchObject({ status: 409 });
  await expect(client.commitUpload(upload.uploadId, undefined, 'excess-finalize')).rejects.toMatchObject({ status: 429 });
  expect(await client.abortUpload(upload.uploadId, undefined, 'abort')).toMatchObject({ state: 'aborted' });
  expect(files.size).toBe(0);
});

it('rejected overlapping chunks do not consume the remaining write admission', async () => {
  const { client, files } = fixture();
  const data = Uint8Array.of(1, 2);
  const upload = await client.beginUpload({ size: '2', digest: createHash('sha256').update(data).digest('hex') });
  await client.uploadChunk(upload.uploadId, '0', data.slice(0, 1), undefined, 'first');
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(client.uploadChunk(upload.uploadId, '0', Uint8Array.of(9), undefined, `conflict-${attempt}`))
      .rejects.toMatchObject({ status: 409 });
  }
  expect(await client.inspectUpload(upload.uploadId)).toMatchObject({ committedOffset: '1' });
  expect(files.get(upload.uploadId)).toEqual(data.slice(0, 1));
  expect(await client.uploadChunk(upload.uploadId, '1', data.slice(1), undefined, 'second'))
    .toMatchObject({ committedOffset: '2', replayed: false });
  await expect(client.commitUpload(upload.uploadId, undefined, 'finalize')).resolves.toMatchObject({ size: '2' });
});
