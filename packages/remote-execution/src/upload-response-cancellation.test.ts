import { expect, it, vi } from 'vitest';
import { createUploadClient } from './uploads.js';
import { createClient } from './client.js';

it.each(['upload', 'generic'] as const)('cancels %s credential acquisition and releases the binary lane before credentials settle', async kind => {
  const controller = new AbortController();
  const reason = new Error('cancel credentials');
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let renew!: (token: string) => void;
  const credentials = new Promise<string>(resolve => { renew = resolve; });
  const token = vi.fn(() => { entered(); return credentials; });
  const transport = vi.fn(async () => Response.json({ uploadId: 'u', size: '1', digest: '0'.repeat(64),
    committedOffset: '1', state: 'open' }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }));
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 1, token, fetch: transport });
  const generic = createClient({ baseUrl: 'https://upload.test', token, fetch: transport });
  const send = (signal?: AbortSignal) => kind === 'upload'
    ? client.uploadChunk('u', '0', Uint8Array.of(1), signal)
    : generic.uploadChunk({ sessionId: 's', epoch: 'e' }, 'u', 0n, Uint8Array.of(1), 'digest', 'key', signal);
  const pending = send(controller.signal).catch(error => error);
  await started;
  controller.abort(reason);
  // An event-loop turn is sufficient for abort delivery; no credential timeout.
  const outcome = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still pending'), 0))]);
  renew('late credential');
  expect(outcome).toBe(reason);
  expect(await pending).toBe(reason);
  expect(transport).not.toHaveBeenCalled();
  token.mockReturnValue(Promise.resolve('renewed'));
  await expect(send()).resolves.toMatchObject({ replayed: false });
});

it.each(['open', 'committed', 'expired'])('rejects an abort receipt that reports %s', async state => {
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 2, token: () => 'token', fetch: async () => Response.json({
      uploadId: 'u', size: '0', digest: '0'.repeat(64), committedOffset: '0', state,
      ...(state === 'committed' ? { blobId: 'b' } : {}),
    }, { headers: { 'Execution-Epoch': 'e' } }) });
  await expect(client.abortUpload('u', undefined, 'abort')).rejects.toMatchObject({ status: 502 });
});

it.each(['beginUpload', 'readBlob'] as const)('drains a late %s response and preserves cancellation', async operation => {
  const controller = new AbortController();
  const reason = new Error('caller left');
  const cancel = vi.fn();
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 2, token: () => 'token', fetch: async () => {
      controller.abort(reason);
      return new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }),
        { headers: { 'Execution-Epoch': 'e' } });
    } });
  const pending = operation === 'readBlob' ? client.readBlob('b', undefined, controller.signal)
    : client.beginUpload({ size: '0', digest: '0'.repeat(64) }, controller.signal);
  await expect(pending).rejects.toBe(reason);
  expect(cancel).toHaveBeenCalledOnce();
});

it.each([401, 410])('preserves observed status %s when failed response disposal rejects', async status => {
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 2, token: () => 'token', fetch: async () => new Response(
      new ReadableStream<Uint8Array>({ cancel() { throw new Error('disposal failed'); } }, { highWaterMark: 0 }),
      { status, headers: { 'Execution-Epoch': 'e' } }),
  });
  await expect(client.inspectUpload('u')).rejects.toMatchObject({ status });
});
