import { expect, it } from 'vitest';
import { createClient } from './client.js';
import { createUploadClient } from './uploads.js';

const declaration = { size: '2', digest: '0'.repeat(64) };

it.each(['generic', 'scoped'] as const)('requires an explicit creation replay receipt in the %s client', async kind => {
  for (const replay of [undefined, '', 'TRUE', '0', 'unknown']) {
    const headers = new Headers({ 'Execution-Epoch': 'e' });
    if (replay !== undefined) headers.set('Upload-Replayed', replay);
    const options = { baseUrl: 'https://upload.test', token: async () => 'token',
      fetch: async () => Response.json({ ...declaration, uploadId: 'u', state: 'open', committedOffset: '0' }, { headers }) };
    const result = kind === 'generic'
      ? createClient(options).beginUpload({ sessionId: 's', epoch: 'e' }, declaration, 'begin')
      : createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 2 }).beginUpload(declaration);
    await expect(result).rejects.toMatchObject({ status: 502 });
  }
});

it.each(['generic', 'scoped'] as const)('rejects invented initial upload progress in the %s client', async kind => {
  for (const fields of [
    { state: 'open', committedOffset: '1' },
    { state: 'committed', committedOffset: '2', blobId: 'b' },
    { state: 'aborted', committedOffset: '0' },
    { state: 'expired', committedOffset: '0' },
  ]) {
    const options = { baseUrl: 'https://upload.test', token: async () => 'token',
      fetch: async () => Response.json({ ...declaration, uploadId: 'u', ...fields },
        { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }) };
    const result = kind === 'generic'
      ? createClient(options).beginUpload({ sessionId: 's', epoch: 'e' }, declaration, 'begin')
      : createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 2 }).beginUpload(declaration);
    await expect(result).rejects.toMatchObject({ status: 502 });
  }
});

it.each(['generic', 'scoped'] as const)('allows explicit begin recovery of committed progress in the %s client', async kind => {
  const options = { baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => Response.json({ ...declaration, uploadId: 'u', state: 'committed', committedOffset: '2', blobId: 'b' },
      { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'true' } }) };
  const result = kind === 'generic'
    ? createClient(options).beginUpload({ sessionId: 's', epoch: 'e' }, declaration, 'begin')
    : createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 2 }).beginUpload(declaration);
  await expect(result).resolves.toMatchObject({ state: 'committed', blobId: 'b' });
});
