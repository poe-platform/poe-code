import { expect, it, vi } from 'vitest';
import { createUploadClient } from './uploads.js';

it('bounds source admission until canceled producer work has drained', async () => {
  let finish!: (result: IteratorResult<Uint8Array>) => void;
  let release!: () => void;
  let entered!: () => void;
  let cleaning!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const draining = new Promise<void>(resolve => { cleaning = resolve; });
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  const iterator = {
    next: vi.fn(() => { entered(); return new Promise<IteratorResult<Uint8Array>>(resolve => { finish = resolve; }); }),
    return: vi.fn(async () => { cleaning(); await cleanup; finish({ done: true, value: undefined }); return { done: true as const, value: undefined }; }),
  };
  const source = { [Symbol.asyncIterator]: vi.fn(() => iterator) };
  const transport = vi.fn(async () => Response.json({ uploadId: 'u', size: '0', digest: '0'.repeat(64),
    committedOffset: '0', state: 'open' }, { headers: { 'Execution-Epoch': 'e' } }));
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 1, token: () => 'token', fetch: transport });
  const controller = new AbortController();
  const reason = new Error('canceled source');
  const first = client.upload('u', source, { signal: controller.signal }).catch(error => error);
  await started;
  const excess = { [Symbol.asyncIterator]: vi.fn(() => ({ next: async () => ({ done: true as const, value: undefined }) })) };
  await expect(client.upload('u', excess)).rejects.toMatchObject({ status: 429 });
  expect(excess[Symbol.asyncIterator]).not.toHaveBeenCalled();
  controller.abort(reason);
  await draining;
  expect(iterator.return).toHaveBeenCalledOnce();
  await expect(client.upload('u', excess)).rejects.toMatchObject({ status: 429 });
  release();
  expect(await first).toBe(reason);
  await expect(client.upload('u', excess)).resolves.toMatchObject({ committedOffset: '0' });
  expect(transport).toHaveBeenCalledOnce();
});

it('releases source admission when iterator acquisition throws', async () => {
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 1, token: () => 'token' });
  const failure = new Error('source acquisition failed');
  const source = { [Symbol.asyncIterator]() { throw failure; } };
  await expect(client.upload('u', source)).rejects.toBe(failure);
  await expect(client.upload('u', source)).rejects.toBe(failure);
});

it('preserves cancellation while draining a producer whose return fails', async () => {
  const controller = new AbortController();
  const reason = new Error('caller canceled');
  let finish!: (result: IteratorResult<Uint8Array>) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const iterator = {
    next: vi.fn(() => {
      entered();
      return new Promise<IteratorResult<Uint8Array>>(resolve => { finish = resolve; });
    }),
    return: vi.fn(async () => {
      finish({ done: true, value: undefined });
      throw new Error('producer cleanup failed');
    }),
  };
  const transport = vi.fn();
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 4, token: () => 'token', fetch: transport });
  const result = client.upload('u', { [Symbol.asyncIterator]: () => iterator }, { signal: controller.signal });
  const observed = result.catch(error => error);
  await started;
  controller.abort(reason);
  expect(await observed).toBe(reason);
  expect(iterator.return).toHaveBeenCalledOnce();
  expect(iterator.next).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
});

it('retains the admitted cancellation signal when borrowed upload options change', async () => {
  const controller = new AbortController();
  const reason = new Error('caller canceled');
  const input: { signal?: AbortSignal } = { signal: controller.signal };
  const iterator = {
    next: vi.fn(async () => {
      input.signal = undefined;
      controller.abort(reason);
      return { done: false as const, value: Uint8Array.of(1) };
    }),
    return: vi.fn(async () => ({ done: true as const, value: undefined })),
  };
  const token = vi.fn(() => 'token');
  const transport = vi.fn();
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 4, token, fetch: transport });
  await expect(client.upload('u', { [Symbol.asyncIterator]: () => iterator }, input)).rejects.toBe(reason);
  expect(iterator.return).toHaveBeenCalledOnce();
  expect(token).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it('preserves a failed transfer when producer cleanup also fails', async () => {
  const reason = new Error('connection lost');
  const iterator = {
    next: vi.fn(async () => ({ done: false as const, value: Uint8Array.of(1) })),
    return: vi.fn(async () => { throw new Error('producer cleanup failed'); }),
  };
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 4, token: () => 'token', fetch: vi.fn(async () => { throw reason; }) });
  await expect(client.upload('u', { [Symbol.asyncIterator]: () => iterator })).rejects.toBe(reason);
  expect(iterator.return).toHaveBeenCalledOnce();
  expect(iterator.next).toHaveBeenCalledOnce();
});
