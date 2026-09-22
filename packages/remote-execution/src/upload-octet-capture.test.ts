import { expect, it, vi } from 'vitest';
import { createUploadClient } from './uploads.js';
import { createClient } from './client.js';

it('retains its authenticated transfer methods before acquiring a borrowed source', async () => {
  let offset = 0;
  const sent: Uint8Array[] = [];
  const receipt = () => ({ uploadId: 'u', size: '2', digest: '0'.repeat(64),
    committedOffset: String(offset), state: 'open' as const });
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'PUT') {
      sent.push(new Uint8Array(init.body as Uint8Array));
      offset += sent.at(-1)!.length;
    }
    return Response.json(receipt(), {
      headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' },
    });
  });
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    token: () => 'token', maxChunkBytes: 1, fetch: transport });
  const replacementChunk = vi.fn(async () => ({ ...receipt(), committedOffset: '2', replayed: true }));
  const replacementInspect = vi.fn(async () => ({ ...receipt(), committedOffset: '2' }));
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      client.uploadChunk = replacementChunk;
      client.inspectUpload = replacementInspect;
      return (async function* () { yield Uint8Array.of(1, 2); })();
    },
  };
  await expect(client.upload('u', source)).resolves.toMatchObject({ committedOffset: '2' });
  expect(sent).toEqual([Uint8Array.of(1), Uint8Array.of(2)]);
  expect(transport).toHaveBeenCalledTimes(3);
  expect(replacementChunk).not.toHaveBeenCalled();
  expect(replacementInspect).not.toHaveBeenCalled();
});

it('enforces the chunk bound against actual octets when length is shadowed', async () => {
  const data = Uint8Array.of(1, 2, 3);
  Object.defineProperty(data, 'length', { value: 1 });
  const token = vi.fn(() => 'token');
  const transport = vi.fn();
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    token, maxChunkBytes: 2, fetch: transport });
  await expect(client.uploadChunk('u', '0', data)).rejects.toMatchObject({ status: 413 });
  expect(token).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it('enforces the generic SDK chunk bound against actual octets', async () => {
  const data = Uint8Array.of(1, 2, 3);
  Object.defineProperty(data, 'length', { value: 1 });
  const token = vi.fn(async () => 'token'); const transport = vi.fn();
  const client = createClient({ baseUrl: 'https://upload.test', token, fetch: transport, maxInputBatchBytes: 2 });
  await expect(client.uploadChunk({ sessionId: 's', epoch: 'e' }, 'u', 0n, data, 'digest', 'key')).rejects.toThrow('bound');
  expect(token).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});

it('captures bounded typed-array octets without invoking a replaceable iterator', async () => {
  const data = Uint8Array.of(1, 2);
  const iterator = vi.fn(function* () { yield* [9, 9, 9, 9]; });
  Object.defineProperty(data, Symbol.iterator, { value: iterator });
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.body).toEqual(Uint8Array.of(1, 2));
    expect(new Headers(init?.headers).get('Content-Length')).toBe('2');
    return Response.json({ uploadId: 'u', size: '2', digest: '0'.repeat(64),
      committedOffset: '2', state: 'open' },
    { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } });
  });
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    token: () => 'token', maxChunkBytes: 2, fetch: transport });
  await expect(client.uploadChunk('u', '0', data)).resolves.toMatchObject({ committedOffset: '2' });
  expect(iterator).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledOnce();
});

it.each(['method', 'species', 'length'] as const)('streams bounded original octets without invoking producer %s hooks', async kind => {
  const hook = vi.fn(() => { throw new Error('producer allocation hook'); });
  class ProducerBytes extends Uint8Array {
    static get [Symbol.species]() { hook(); return Uint8Array; }
  }
  const data = kind === 'species' ? new ProducerBytes([1, 2, 3]) : Uint8Array.of(1, 2, 3);
  if (kind === 'method') Object.defineProperty(data, 'subarray', { value: hook });
  if (kind === 'length') Object.defineProperty(data, 'length', { value: 1 });
  const sent: Uint8Array[] = [];
  let offset = 0;
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'PUT') {
      const chunk = init.body as Uint8Array;
      sent.push(new Uint8Array(chunk)); offset += chunk.length;
    }
    return Response.json({ uploadId: 'u', size: '3', digest: '0'.repeat(64),
      committedOffset: String(offset), state: 'open' },
    { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } });
  });
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    token: () => 'token', maxChunkBytes: 2, fetch: transport });
  await expect(client.upload('u', (async function* () { yield data; })())).resolves.toMatchObject({ committedOffset: '3' });
  expect(sent).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3)]);
  expect(hook).not.toHaveBeenCalled();
});
