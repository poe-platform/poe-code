import { expect, it, vi } from 'vitest';
import { createUploadClient } from './uploads.js';

it('sends the exact range observation admitted before credentials', async () => {
  let starts = 0;
  let ends = 0;
  const range = {
    get start() { return ++starts === 1 ? '9007199254740993' : '0'; },
    get end() { return ++ends === 1 ? '9007199254740994' : '1'; },
  };
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('Range')).toBe('bytes=9007199254740993-9007199254740994');
    return new Response(null, { headers: { 'Execution-Epoch': 'e' } });
  });
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 2, token: () => 'token', fetch: transport });
  await client.readBlob('b', range);
  expect(starts).toBe(1);
  expect(ends).toBe(1);
});

it.each([
  { start: '2', end: '1' },
  { start: '9007199254740993', end: '9007199254740992' },
  { start: '18446744073709551615', end: '18446744073709551614' },
])('rejects reversed blob ranges before credentials or transport %j', async range => {
  const token = vi.fn(() => 'token');
  const transport = vi.fn<typeof fetch>(async () => new Response(null, {
    headers: { 'Execution-Epoch': 'e' },
  }));
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 2, token, fetch: transport });
  await expect(client.readBlob('b', range)).rejects.toMatchObject({ status: 400 });
  expect(token).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  { start: '9007199254740993', end: '9007199254740993' },
  { start: '18446744073709551615' },
])('preserves exact uint64 blob ranges %j', async range => {
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('Range')).toBe(`bytes=${range.start}-${range.end ?? ''}`);
    return new Response(null, { headers: { 'Execution-Epoch': 'e' } });
  });
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    maxChunkBytes: 2, token: () => 'token', fetch: transport });
  await client.readBlob('b', range);
  expect(transport).toHaveBeenCalledOnce();
});
