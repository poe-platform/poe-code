import { expect, it, vi } from 'vitest';
import { createUploadServer, type UploadPrincipal } from './server.js';

const principal: UploadPrincipal = { tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e',
  expiresAt: Date.now() + 60000, sessionExpiresAt: Date.now() + 60000 };
const request = (signal?: AbortSignal) => new Request('https://upload.test/v1/sessions/s/uploads', {
  method: 'POST', signal, body: JSON.stringify({ size: '0', digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }),
  headers: { 'Content-Type': 'application/json', 'Execution-Protocol': '1', 'Execution-Epoch': 'e',
    'Idempotency-Key': 'begin' },
});
function fixture() {
  let resolve!: (value: UploadPrincipal) => void;
  const pending = new Promise<UploadPrincipal>(done => { resolve = done; });
  const authenticate = vi.fn((_request: Request, _signal?: AbortSignal) => pending);
  const storage = { append: vi.fn(), read: vi.fn(), remove: vi.fn() };
  const server = createUploadServer({ authenticate, storage,
    limits: { maxBlobBytes: 1n, maxReservedBytes: 1n, maxChunkBytes: 1, maxConcurrent: 1, maxUploads: 1, maxChunks: 1 } });
  return { server, authenticate, storage, resolve };
}

it('cancels authentication admission before a late credential can create an upload', async () => {
  const f = fixture(); const controller = new AbortController(); const reason = new Error('caller left');
  const pending = f.server.fetch(request(controller.signal)).catch(error => error);
  controller.abort(reason);
  const outcome = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still pending'), 0))]);
  f.resolve(principal);
  expect(outcome).toBe(reason);
  expect(await pending).toBe(reason);
  expect(f.authenticate.mock.calls[0]?.[1]).toMatchObject({ aborted: true });
  await f.server.close();
  expect(f.storage.remove).not.toHaveBeenCalled();
});

it('keeps canceled host credential work bounded until the callback settles', async () => {
  const f = fixture(); const controller = new AbortController();
  const pending = f.server.fetch(request(controller.signal)).catch(error => error);
  controller.abort(new Error('cancel'));
  await pending;
  expect((await f.server.fetch(request())).status).toBe(429);
  expect(f.authenticate).toHaveBeenCalledTimes(1);
  f.resolve(principal);
  await Promise.resolve();
  expect((await f.server.fetch(request())).status).toBe(200);
  await f.server.close();
});

it('bounds authentication admissions before credentials resolve', async () => {
  const f = fixture();
  const first = f.server.fetch(request());
  const second = f.server.fetch(request());
  const outcome = await Promise.race([second, new Promise(resolve => setTimeout(() => resolve('still pending'), 0))]);
  f.resolve(principal);
  expect(outcome).toBeInstanceOf(Response);
  expect((outcome as Response).status).toBe(429);
  expect(f.authenticate).toHaveBeenCalledTimes(1);
  expect((await first).status).toBe(200);
  await f.server.close();
});

it('shutdown cancels pending authentication without waiting for a late credential', async () => {
  const f = fixture(); const pending = f.server.fetch(request());
  const closing = f.server.close();
  const outcome = await Promise.race([closing.then(() => 'closed'), new Promise(resolve => setTimeout(() => resolve('still pending'), 0))]);
  f.resolve(principal);
  expect(outcome).toBe('closed');
  expect((await pending).status).toBe(503);
  await closing;
  expect(f.storage.remove).not.toHaveBeenCalled();
});
