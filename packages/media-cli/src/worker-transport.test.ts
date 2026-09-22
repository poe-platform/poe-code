import { expect, it, vi } from 'vitest';
import { createWorkerTransport } from '../deploy/transport.js';

it.each(['rejected', 'empty-response', 'response-eof'] as const)('retires an unread upload when its transfer ends: %s', async mode => {
  const abort = new AbortController();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
  const endpoint = { async fetch() {
    if (mode === 'rejected') throw new Error('Container unavailable');
    return new Response(mode === 'response-eof' ? new Uint8Array([255]) : null);
  } };
  const transfer = createWorkerTransport(endpoint, abort.signal, abort)('https://container.internal/v1/blob', {
    method: 'PUT', body, duplex: 'half',
  } as RequestInit);
  if (mode === 'rejected') await expect(transfer).rejects.toThrow('Container unavailable');
  else {
    const response = await transfer;
    if (response.body) {
      expect(cancel).not.toHaveBeenCalled();
      const reader = response.body.getReader();
      expect((await reader.read()).value).toEqual(new Uint8Array([255]));
      expect((await reader.read()).done).toBe(true);
      reader.releaseLock();
    }
  }
  expect(cancel).toHaveBeenCalledOnce();
  expect(abort.signal.aborted).toBe(false);
});

it('preserves binary request/response bytes and keeps redirects manual', async () => {
  const abort = new AbortController();
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const endpoint = { fetch: vi.fn(async (request: Request) => {
    expect(request.redirect).toBe('manual');
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes); // Fixed fixture only.
    return new Response(bytes, { status: 206, headers: { 'Execution-Epoch': 'epoch' } });
  }) };
  const response = await createWorkerTransport(endpoint, abort.signal, abort)('https://container.internal/v1/blob', {
    method: 'PUT', body: bytes, redirect: 'error',
  });
  expect(response.status).toBe(206);
  expect(response.headers.get('Execution-Epoch')).toBe('epoch');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes); // Fixed fixture only.
  expect(abort.signal.aborted).toBe(false);
});

it('retires an oversized upload and cancels its producer before reporting failure', async () => {
  const abort = new AbortController();
  const cancel = vi.fn();
  const endpoint = { fetch: vi.fn(async (request: Request) => {
    await request.body!.getReader().read();
    return new Response();
  }) };
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel,
  }, { highWaterMark: 0 });
  await expect(createWorkerTransport(endpoint, abort.signal, abort)('https://container.internal/v1/blob', {
    method: 'PUT', body, duplex: 'half',
  } as RequestInit)).rejects.toThrow('Transfer byte limit');
  expect(cancel).toHaveBeenCalledOnce();
  expect(abort.signal.reason).toEqual(new RangeError('Transfer byte limit'));
});

it('allows cancellation of a partial range with a pending read without canceling its command', async () => {
  const abort = new AbortController();
  const cancel = vi.fn();
  const endpoint = { fetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })) };
  const response = await createWorkerTransport(endpoint, abort.signal, abort)('https://container.internal/v1/blob');
  const reader = response.body!.getReader();
  const read = reader.read();
  await reader.cancel('range no longer needed');
  expect(await read).toEqual({ done: true, value: undefined });
  expect(cancel).toHaveBeenCalledOnce();
  expect(abort.signal.aborted).toBe(false);
});

it('holds transfer credits until response retirement and returns canceled range credit', async () => {
  const abort = new AbortController();
  const endpoint = { fetch: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({}, { highWaterMark: 0 }))) };
  const fetch = createWorkerTransport(endpoint, abort.signal, abort);
  const responses: Response[] = [];
  try {
    for (let i = 0; i < 4; i++) responses.push(await fetch('https://container.internal/v1/blob'));
    await responses.shift()!.body!.cancel();
    responses.push(await fetch('https://container.internal/v1/blob'));
    expect(abort.signal.aborted).toBe(false);
    await expect(fetch('https://container.internal/v1/blob')).rejects.toThrow('Canonical transfer credit exhausted');
    expect(endpoint.fetch).toHaveBeenCalledTimes(5);
    expect(abort.signal.reason).toEqual(new RangeError('Canonical transfer credit exhausted'));
  } finally { await Promise.all(responses.map(response => response.body!.cancel().catch(() => {}))); }
});

it('enforces the total range byte limit across individually admitted chunks', async () => {
  const abort = new AbortController();
  const chunk = new Uint8Array(65536);
  const cancel = vi.fn();
  const endpoint = { fetch: async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(chunk); }, cancel,
  }, { highWaterMark: 0 })) };
  const response = await createWorkerTransport(endpoint, abort.signal, abort)('https://container.internal/v1/blob');
  const reader = response.body!.getReader();
  for (let i = 0; i < 1024; i++) expect((await reader.read()).value?.byteLength).toBe(65536);
  await expect(reader.read()).rejects.toThrow('Transfer byte limit');
  expect(cancel).toHaveBeenCalledOnce();
  expect(abort.signal.aborted).toBe(true);
});
