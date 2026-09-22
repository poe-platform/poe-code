import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createUploadClient } from './uploads.js';

it.each(['generic', 'upload'] as const)('bounds pending %s credentials after upload cancellation', async kind => {
  let settle!: (token: string) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const token = vi.fn(() => { entered(); return new Promise<string>(resolve => { settle = resolve; }); });
  const transport = vi.fn<typeof fetch>(async () => Response.json({ uploadId: 'u', size: '1', digest: '0'.repeat(64),
    committedOffset: '1', state: 'open' }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }));
  const options = { baseUrl: 'https://upload.test', token, fetch: transport, maxConcurrentUploads: 1 };
  const generic = createClient(options);
  const upload = createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 1 });
  const send = (signal?: AbortSignal) => kind === 'generic'
    ? generic.uploadChunk({ sessionId: 's', epoch: 'e' }, 'u', 0n, Uint8Array.of(1), 'digest', 'key', signal)
    : upload.uploadChunk('u', '0', Uint8Array.of(1), signal);
  const controller = new AbortController();
  const reason = new Error('caller canceled');
  const pending = send(controller.signal).catch(error => error);
  await started;
  controller.abort(reason);
  expect(await pending).toBe(reason);
  token.mockImplementation(async () => { throw new Error('excess credentials'); });
  // Canceled credential suppliers remain real work until they settle.
  const excess = send().catch(error => error);
  await expect(excess).resolves.toMatchObject({ status: 429 });
  expect(token).toHaveBeenCalledOnce();
  settle('late');
  await Promise.resolve();
  await Promise.resolve();
  token.mockImplementation(async () => 'renewed');
  await expect(send()).resolves.toMatchObject({ replayed: false });
  expect(transport).toHaveBeenCalledOnce();
});

it.each(['generic', 'upload'] as const)('bounds %s client chunk lanes before credentials and releases failed lanes', async kind => {
  let fail!: (cause: Error) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const token = vi.fn(async (): Promise<string> => { throw new Error('excess credential request'); }).mockImplementationOnce(async () => {
    entered();
    return new Promise<string>((_, reject) => { fail = reject; });
  });
  const transport = vi.fn();
  const options = { baseUrl: 'https://upload.test', token, fetch: transport, maxConcurrentUploads: 1 };
  const generic = createClient(options);
  const upload = createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 2 });
  const send = () => kind === 'generic'
    ? generic.uploadChunk({ sessionId: 's', epoch: 'e' }, 'u', 0n, Uint8Array.of(1), 'digest', 'key')
    : upload.uploadChunk('u', '0', Uint8Array.of(1));
  const first = send().catch(error => error);
  await started;
  const second = send();
  // Observe rejection immediately so a broken capacity implementation cannot
  // leave an unhandled rejection while the first credential request is pending.
  const observed = second.catch(error => error);
  await expect(observed).resolves.toMatchObject({ status: 429 });
  expect(token).toHaveBeenCalledOnce();
  fail(new Error('credentials unavailable'));
  await first;
  token.mockRejectedValue(new Error('next credential request'));
  const third = await send().catch(error => error);
  expect(third.status).not.toBe(429);
  expect(token).toHaveBeenCalledTimes(2);
  expect(transport).not.toHaveBeenCalled();
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid upload concurrency %s', maxConcurrentUploads => {
  const options = { baseUrl: 'https://upload.test', token: async () => 'token', maxConcurrentUploads };
  expect(() => createClient(options)).toThrow('bound');
  expect(() => createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 2 })).toThrow('bound');
});

it.each(['generic', 'upload'] as const)('holds the %s lane through receipt delivery and releases it on cancellation', async kind => {
  const controller = new AbortController();
  const reason = new Error('cancel receipt');
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const cancel = vi.fn();
  const transport = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
    pull() { entered(); }, cancel,
  }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'e' } }));
  const options = { baseUrl: 'https://upload.test', token: async () => 'token', fetch: transport, maxConcurrentUploads: 1 };
  const generic = createClient(options);
  const upload = createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 2 });
  const send = (signal?: AbortSignal) => kind === 'generic'
    ? generic.uploadChunk({ sessionId: 's', epoch: 'e' }, 'u', 0n, Uint8Array.of(1), 'digest', 'key', signal)
    : upload.uploadChunk('u', '0', Uint8Array.of(1), signal);
  const first = send(controller.signal).catch(error => error);
  await started;
  options.maxConcurrentUploads = 2;
  await expect(send()).rejects.toMatchObject({ status: 429 });
  controller.abort(reason);
  expect(await first).toBe(reason);
  expect(cancel).toHaveBeenCalledOnce();
  transport.mockImplementationOnce(async () => Response.json({ uploadId: 'u', size: '1', digest: '0'.repeat(64),
    committedOffset: '1', state: 'open' }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }));
  await expect(send()).resolves.toMatchObject({ committedOffset: '1', replayed: false });
});
