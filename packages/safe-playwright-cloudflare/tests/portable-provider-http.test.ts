import { expect, test, vi } from 'vitest';
import { once } from 'node:events';
import { request } from '../scripts/portable-provider/http.js';

test('HTTP bridge preserves binary payloads, cookies and manual redirect responses', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    expect(String(url)).toBe('https://api.test/path?query=1');
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('cookie')).toBe('owner=private');
    expect(options?.redirect).toBe('manual');
    expect(Array.from(options?.body as Uint8Array)).toEqual([0, 128, 255]);
    return new Response(Uint8Array.of(255, 0, 128), { status: 302, headers: {
      location: '/next', 'set-cookie': 'updated=yes; Path=/',
    } });
  });
  try {
    const pending = request(new URL('https://api.test/path?query=1'), { method: 'POST', headers: { Cookie: 'owner=private' } });
    const response = once(pending, 'response');
    pending.end(Uint8Array.of(0, 128, 255));
    const [incoming] = await response;
    expect(incoming.statusCode).toBe(302);
    expect(incoming.headers.location).toBe('/next');
    expect(incoming.headers['set-cookie']).toEqual(['updated=yes; Path=/']);
    const bytes: number[] = [];
    for await (const chunk of incoming) bytes.push(...chunk);
    expect(bytes).toEqual([255, 0, 128]);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { fetch.mockRestore(); }
});

test('HTTP bridge preserves original headers while avoiding a second body decode', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('decoded', { headers: {
    'content-encoding': 'gzip', 'content-length': '999',
  } }));
  try {
    const pending = request('https://api.test/');
    const response = once(pending, 'response');
    pending.end();
    const [incoming] = await response;
    expect(incoming.headers['content-encoding']).toBeUndefined();
    expect(incoming.rawHeaders).toEqual(['content-encoding', 'gzip', 'content-length', '999', 'content-type', 'text/plain;charset=UTF-8']);
    let body = '';
    for await (const chunk of incoming) body += chunk.toString();
    expect(body).toBe('decoded');
  } finally { fetch.mockRestore(); }
});

test('destroying an HTTP request aborts its in-flight fetch', async () => {
  let signal: AbortSignal | undefined;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    signal = options?.signal ?? undefined;
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  });
  try {
    const pending = request('https://api.test/');
    const finished = once(pending, 'finish');
    pending.end();
    await finished;
    expect(signal?.aborted).toBe(false);
    const closed = once(pending, 'close');
    pending.destroy();
    await closed;
    expect(signal?.aborted).toBe(true);
  } finally { fetch.mockRestore(); }
});

test('destroying a response cancels its Fetch body without waiting for another chunk', async () => {
  const canceled = vi.fn();
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel: canceled,
  }), { headers: { 'content-length': '100' } }));
  try {
    const pending = request('https://api.test/');
    const response = once(pending, 'response');
    pending.end();
    const [incoming] = await response;
    expect(incoming.headers['content-length']).toBe('100');
    await once(incoming, 'data');
    const closed = once(incoming, 'close');
    pending.destroy();
    await closed;
    expect(canceled).toHaveBeenCalledTimes(1);
  } finally { fetch.mockRestore(); }
});

test.each([undefined, Infinity, 0])('HTTP timeout %s does not schedule a timer', timeout => {
  const timer = vi.spyOn(globalThis, 'setTimeout');
  try {
    const pending = request('https://api.test/', { timeout });
    expect(timer).not.toHaveBeenCalled();
    pending.destroy();
  } finally { timer.mockRestore(); }
});
