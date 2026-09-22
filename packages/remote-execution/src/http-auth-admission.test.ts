import {expect, it, vi} from 'vitest';
import {createMediaServer, type MediaPrincipal} from './media-server.js';

function fixture() {
  let resolve!: (principal: MediaPrincipal | null) => void;
  const pending = new Promise<MediaPrincipal | null>(done => { resolve = done; });
  const authenticate = vi.fn((_request: Request, _signal?: AbortSignal) => pending);
  const admitSession = vi.fn();
  const server = createMediaServer({authenticate, builds: [], tools: [],
    driver: {features: [], inspectBuild: vi.fn(), admitSession},
    admissions: {record: vi.fn(), inspect: vi.fn()},
    storage: {append: vi.fn(), read: vi.fn(), remove: vi.fn()},
    limits: {maxJobs: 1, maxHandles: 1, maxArgvBytes: 64, maxManifestEntries: 1,
      maxFrameBytes: 4096, maxInflightBytes: 8192, maxBlobBytes: 8192,
      maxReplayBytes: 65536, maxCallbacks: 1, maxNativeMemoryBytes: 8192,
      maxNativeProcesses: 1, maxJobDurationMs: 10000},
    leaseMs: 10000, retentionMs: 20000, maxDocumentBytes: 4096, maxRecords: 1});
  return {server, authenticate, admitSession, resolve};
}
const request = (signal?: AbortSignal) => new Request('https://media.test/v1/capabilities', {signal});
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

it('bounds credential callbacks before they resolve', async () => {
  const f = fixture();
  const first = f.server.fetch(request());
  const second = f.server.fetch(request());
  const observed = await Promise.race([second, tick().then(() => null)]);
  const calls = f.authenticate.mock.calls.length;
  f.resolve(null);
  await Promise.all([first, second, f.server.close()]);
  expect(observed?.status).toBe(429);
  expect(calls).toBe(1);
});

it('cancels callers promptly while retaining the unfinished credential admission', async () => {
  const f = fixture(); const controller = new AbortController();
  const first = f.server.fetch(request(controller.signal));
  await Promise.resolve();
  controller.abort(new Error('disconnected'));
  const observed = await Promise.race([first, tick().then(() => null)]);
  const second = f.server.fetch(request());
  const overloaded = await Promise.race([second, tick().then(() => null)]);
  const closing = f.server.close(); let closed = false;
  void closing.then(() => { closed = true; });
  await tick(); const closedEarly = closed;
  const signal = f.authenticate.mock.calls[0]?.[1];
  f.resolve({tenantId: 'tenant', principalId: 'owner', expiresAt: Date.now() + 60000});
  await Promise.all([first, second, closing]);
  expect(observed).toBeInstanceOf(Response);
  expect(overloaded?.status).toBe(429);
  expect(signal?.aborted).toBe(true);
  expect(closedEarly).toBe(false);
  expect(f.admitSession).not.toHaveBeenCalled();
});

it('shutdown interrupts authentication delivery and drains late host work', async () => {
  const f = fixture(); const pending = f.server.fetch(request());
  await Promise.resolve();
  const closing = f.server.close();
  const observed = await Promise.race([pending, tick().then(() => null)]);
  const signal = f.authenticate.mock.calls[0]?.[1];
  f.resolve(null); await Promise.all([pending, closing]);
  expect(observed?.status).toBe(503);
  expect(signal?.aborted).toBe(true);
});

it.each([
  ['POST', 'sessions/session/jobs/job/cancel'],
  ['POST', 'sessions/session/jobs/job/signal'],
  ['POST', 'sessions/session/jobs/job/callbacks/callback/result'],
  ['POST', 'sessions/session/materializations/operation/callbacks/callback/result'],
  ['POST', 'sessions/session/jobs/job/lanes/lane/ack'],
  ['POST', 'sessions/session/lease'],
  ['POST', 'sessions/session/jobs/job/resources/release'],
  ['DELETE', 'sessions/session'],
  ['DELETE', 'sessions/session/uploads/upload'],
])('reserves bounded authentication capacity for %s %s while data admissions are stalled', async (method, path) => {
  const f = fixture();
  const data = f.server.fetch(request());
  await Promise.resolve();
  const control = f.server.fetch(new Request('https://media.test/v1/' + path, {method}));
  await Promise.resolve();
  const calls = f.authenticate.mock.calls.length;
  const overloaded = await f.server.fetch(new Request('https://media.test/v1/' + path, {method}));
  f.resolve(null); await Promise.all([data, control, f.server.close()]);
  expect(calls).toBe(2);
  expect(overloaded.status).toBe(429);
});

it('does not acquire credentials for a pre-aborted request', async () => {
  const f = fixture(); const controller = new AbortController();
  controller.abort(new Error('already disconnected'));
  await f.server.fetch(request(controller.signal));
  await f.server.close();
  expect(f.authenticate).not.toHaveBeenCalled();
});
