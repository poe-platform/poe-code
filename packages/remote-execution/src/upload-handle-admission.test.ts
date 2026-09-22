import { expect, it } from 'vitest';
import { createClient } from './client.js';
import { createUploadClient } from './uploads.js';

const session = { sessionId: 's', epoch: 'e' };
const declaration = { size: '0', digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };

it.each(['generic', 'scoped'] as const)('rejects unroutable upload and blob handles from %s receipts', async kind => {
  for (const id of ['.', '..', '\ud800']) {
    for (const operation of ['begin', 'status', 'commit'] as const) {
      const value = operation === 'commit' ? { ...declaration, blobId: id }
        : { ...declaration, uploadId: operation === 'begin' ? id : 'u', committedOffset: '0',
          state: operation === 'status' ? 'committed' : 'open',
          ...(operation === 'status' ? { blobId: id } : {}) };
      const options = { baseUrl: 'https://upload.test', token: async () => 'token',
        fetch: async () => Response.json(value, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }) };
      const generic = createClient(options);
      const scoped = createUploadClient({ ...options, ...session, maxChunkBytes: 1 });
      const result = kind === 'generic'
        ? operation === 'begin' ? generic.beginUpload(session, declaration, 'begin')
          : operation === 'status' ? generic.inspectUpload(session, 'u') : generic.commitUpload(session, 'u', 'commit')
        : operation === 'begin' ? scoped.beginUpload(declaration)
          : operation === 'status' ? scoped.inspectUpload('u') : scoped.commitUpload('u');
      await expect(result).rejects.toMatchObject({ status: 502 });
    }
  }
});
