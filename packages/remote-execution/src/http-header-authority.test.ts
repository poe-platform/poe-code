import {PassThrough, Writable} from 'node:stream';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {expect, it, vi} from 'vitest';
import {createMediaHttpHandler} from './http-server.js';

it.each(['Authorization', 'Idempotency-Key', 'Execution-Epoch', 'Execution-Profile', 'Execution-Protocol', 'Execution-Cursor', 'Execution-Offset', 'Content-Type', 'Content-Length', 'Content-Digest', 'If-Match', 'Range', 'Upload-Offset', 'Digest'])('rejects duplicate %s before authenticated dispatch', async name => {
  // IncomingMessage.headers may discard or join duplicates. Authority must be
  // checked against the original HTTP fields, including different casing.
  const input = Object.assign(new PassThrough(), {
    method: 'GET', url: '/v1/capabilities',
    headers: {authorization: 'Bearer first'},
    rawHeaders: [name, 'first', name.toLowerCase(), 'second'],
  });
  const output = Object.assign(new Writable({write(_chunk, _encoding, done) {done();}}), {writeHead: vi.fn()});
  const fetch = vi.fn(async () => new Response());
  input.end();
  await createMediaHttpHandler({origin: 'https://media.test', maxConnections: 1, fetch})(input as unknown as IncomingMessage, output as unknown as ServerResponse);
  expect(fetch).not.toHaveBeenCalled();
  expect(output.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
});

it('preserves repeatable negotiation fields and releases capacity after header rejection', async () => {
  const fetch = vi.fn(async (request: Request) => {
    expect(request.headers.get('Accept')).toBe('application/json, application/octet-stream');
    return new Response();
  });
  const handler = createMediaHttpHandler({origin: 'https://media.test', maxConnections: 1, fetch});
  for (const duplicate of [true, false]) {
    const input = Object.assign(new PassThrough(), {
      method: 'GET', url: '/v1/capabilities',
      headers: {authorization: 'Bearer first', accept: ['application/json', 'application/octet-stream']},
      rawHeaders: duplicate ? ['Authorization', 'Bearer first', 'authorization', 'Bearer second']
        : ['Authorization', 'Bearer first', 'Accept', 'application/json', 'Accept', 'application/octet-stream'],
    });
    const output = Object.assign(new Writable({write(_chunk, _encoding, done) {done();}}), {writeHead: vi.fn()});
    input.end();
    await handler(input as unknown as IncomingMessage, output as unknown as ServerResponse);
    expect(output.writeHead).toHaveBeenCalledWith(duplicate ? 400 : 200, expect.any(Object));
  }
  expect(fetch).toHaveBeenCalledOnce();
});
