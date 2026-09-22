import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createUploadClient } from './uploads.js';

it.each(['underreported', 'overreported'] as const)('bounds generic upload controls by actual bytes with %s length', async kind => {
  const receipt = { uploadId: 'u', size: '0', digest: '0'.repeat(64), committedOffset: '0', state: 'open' };
  const bytes = new TextEncoder().encode(JSON.stringify(receipt));
  Object.defineProperty(bytes, 'length', { value: kind === 'underreported' ? 0 : 4096 });
  Object.defineProperty(bytes, 'byteLength', { value: kind === 'underreported' ? 0 : 4096 });
  const cancel = vi.fn();
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    maxResponseBytes: kind === 'underreported' ? 8 : 512,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); },
      pull(controller) { controller.close(); }, cancel,
    }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'e' } }),
  });
  const pending = client.inspectUpload({ sessionId: 's', epoch: 'e' }, 'u');
  if (kind === 'underreported') {
    await expect(pending).rejects.toMatchObject({ status: 502, phase: 'unknown' });
    expect(cancel).toHaveBeenCalledOnce();
  } else await expect(pending).resolves.toEqual(receipt);
});

it.each([
  { kind: 'upload', fragment: 'array' }, { kind: 'generic', fragment: 'array' },
  { kind: 'upload', fragment: 'object' }, { kind: 'generic', fragment: 'object' },
  { kind: 'upload', fragment: 'view' }, { kind: 'generic', fragment: 'view' },
])('rejects $fragment fragments in $kind upload control and drains the transport', async ({ kind, fragment }) => {
  const receipt = { uploadId: 'u', size: '0', digest: '0'.repeat(64), committedOffset: '0', state: 'open' };
  const encoded = new TextEncoder().encode(JSON.stringify(receipt));
  const invalid = fragment === 'array' ? Array.from(encoded)
    : fragment === 'object' ? { ...encoded, length: encoded.length }
    : new DataView(encoded.buffer);
  const cancel = vi.fn();
  const transport = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(invalid); },
    pull(controller) { controller.close(); },
    cancel,
  }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'e' } });
  const options = { baseUrl: 'https://upload.test', token: async () => 'token', fetch: transport };
  const pending = kind === 'upload'
    ? createUploadClient({ ...options, sessionId: 's', epoch: 'e', maxChunkBytes: 1 }).inspectUpload('u')
    : createClient(options).inspectUpload({ sessionId: 's', epoch: 'e' }, 'u');
  await expect(pending).rejects.toMatchObject({ status: 502 });
  expect(cancel).toHaveBeenCalledOnce();
});
