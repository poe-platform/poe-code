import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createUploadClient } from './uploads.js';

it.each(['generic', 'upload'] as const)('bounds %s upload metadata delivery independently of binary chunks', async kind => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const cancel = vi.fn();
  const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
    pull() { entered(); }, cancel,
  }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'e' } }));
  const token = vi.fn(async () => 'token');
  const options = { baseUrl: 'https://upload.test', token, fetch: transport, maxConcurrentUploads: 1 };
  const generic = createClient(options);
  const upload = createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 1 });
  const inspect = (signal?: AbortSignal) => kind === 'generic'
    ? generic.inspectUpload({ sessionId: 's', epoch: 'e' }, 'u', signal)
    : upload.inspectUpload('u', signal);
  const controller = new AbortController();
  const pending = inspect(controller.signal).catch(error => error);
  await started;
  // Keep the assertion concrete without leaving a stalled excess request behind
  // when run against an implementation that lacks metadata admission.
  const excessController = new AbortController();
  const excess = inspect(excessController.signal).catch(error => error);
  await new Promise<void>(resolve => { setTimeout(resolve, 0); });
  excessController.abort(new Error('retire excess request'));
  const error = await excess;
  controller.abort(new Error('retire first request'));
  await pending;
  expect(error).toMatchObject({ status: 429 });
  expect(transport).toHaveBeenCalledOnce();
  expect(token).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  transport.mockImplementationOnce(async () => Response.json({
    uploadId: 'u', size: '0', digest: '0'.repeat(64), state: 'open', committedOffset: '0',
  }, { headers: { 'Execution-Epoch': 'e' } }));
  await expect(inspect()).resolves.toMatchObject({ uploadId: 'u' });
});

it.each(['generic', 'upload'] as const)('keeps %s abort admission available during stalled metadata delivery', async kind => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const receipt = { uploadId: 'u', size: '0', digest: '0'.repeat(64), committedOffset: '0' };
  const transport = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'DELETE'
    ? Response.json({ ...receipt, state: 'aborted' }, { headers: { 'Execution-Epoch': 'e' } })
    : new Response(new ReadableStream<Uint8Array>({ pull() { entered(); } }, { highWaterMark: 0 }),
      { headers: { 'Execution-Epoch': 'e' } }));
  const options = { baseUrl: 'https://upload.test', token: async () => 'token', fetch: transport, maxConcurrentUploads: 1 };
  const generic = createClient(options);
  const upload = createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 1 });
  const controller = new AbortController();
  const pending = (kind === 'generic'
    ? generic.inspectUpload({ sessionId: 's', epoch: 'e' }, 'u', controller.signal)
    : upload.inspectUpload('u', controller.signal)).catch(error => error);
  await started;
  try {
    const aborted = kind === 'generic'
      ? await generic.abortUpload({ sessionId: 's', epoch: 'e' }, 'u', 'abort')
      : await upload.abortUpload('u');
    expect(aborted.state).toBe('aborted');
  } finally {
    controller.abort(new Error('retire inspection'));
    await pending;
  }
});
