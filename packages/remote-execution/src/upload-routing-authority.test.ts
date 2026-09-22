import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createMediaServer, type MediaPrincipal } from './media-server.js';
import type { Build, Limits } from './wire.generated.js';

const digest = 'a'.repeat(64);
const build: Build = { digest, imageDigest: 'sha256:' + digest, os: 'linux', architecture: 'x86_64',
  executables: { tool: digest }, librariesDigest: digest, inventoryDigest: digest, assetsDigest: digest,
  launcherRevision: 'launcher', bridgeRevision: 'bridge', runtimeRequirements: [], runtimeEnvironment: {},
  policyDigest: digest, configDigest: digest, policyDifferences: ['network denied'],
  inventory: { codecs: [], coders: [], delegates: [], fonts: [], profiles: [] } };
const limits: Limits = { maxJobs: 2, maxHandles: 4, maxArgvBytes: 64, maxManifestEntries: 8,
  maxFrameBytes: 4096, maxInflightBytes: 8192, maxBlobBytes: 8192, maxReplayBytes: 65536,
  maxCallbacks: 8, maxNativeMemoryBytes: 8192, maxNativeProcesses: 4, maxJobDurationMs: 10000 };

function fixture() {
  const owner: MediaPrincipal = { tenantId: 'tenant', principalId: 'owner', expiresAt: 100000 };
  const authenticate = vi.fn(async (): Promise<MediaPrincipal> => ({ ...owner }));
  const contents = new Map<string, Uint8Array>();
  const storage = {
    append: vi.fn(async (id: string, _offset: bigint, bytes: Uint8Array) => { contents.set(id, bytes.slice()); }),
    read: vi.fn(async (id: string, offset: bigint, count: number) =>
      (contents.get(id) ?? new Uint8Array()).slice(Number(offset), Number(offset) + count)),
    remove: vi.fn(async (id: string) => { contents.delete(id); }),
  };
  const prepare = vi.fn(); const close = vi.fn(async () => {});
  const server = createMediaServer({ authenticate, builds: [build],
    tools: [{ id: 'tool', buildDigest: digest, executable: '/tools/tool', requiredFeatures: [] }],
    driver: { features: [], async inspectBuild() { return structuredClone(build); },
      async admitSession() { return { prepare, close }; } },
    admissions: { async record() {}, async inspect() { return null; } }, storage, limits,
    leaseMs: 10000, retentionMs: 20000, maxDocumentBytes: 16384, maxRecords: 32, now: () => 1000 });
  const client = createClient({ baseUrl: 'https://media.test', async token() { return 'owner'; },
    fetch: async (input, init) => server.fetch(new Request(input, init)) });
  return { owner, authenticate, storage, contents, prepare, close, server, client };
}

it.each(['begin', 'inspect', 'chunk', 'commit', 'abort', 'blob-metadata', 'blob-range'] as const)(
  'refuses %s when upload routing reauthentication narrows credentials to an invocation', async operation => {
    const f = fixture();
    try {
      const session = await f.client.openSession({ buildDigest: digest, bindings: [], limits }, 'session');
      const bytes = Uint8Array.of(0, 255, 128);
      const hash = createHash('sha256').update(bytes);
      const declaration = { size: String(bytes.length), digest: hash.digest('hex') };
      const chunkDigest = 'sha-256=:' + Buffer.from(declaration.digest, 'hex').toString('base64') + ':';
      const upload = await f.client.beginUpload(session, declaration, 'upload');
      if (operation !== 'chunk') await f.client.uploadChunk(session, upload.uploadId, 0n, bytes, chunkDigest, 'chunk');
      const blob = operation.startsWith('blob-') ? await f.client.commitUpload(session, upload.uploadId, 'commit') : undefined;
      f.storage.append.mockClear(); f.storage.read.mockClear(); f.storage.remove.mockClear();
      // The outer route admits an owner. Its independent upload authenticator
      // then returns a narrower host credential for the same tenant/session.
      f.authenticate.mockResolvedValueOnce({ ...f.owner }).mockResolvedValue({ ...f.owner,
        sessionId: session.sessionId, epoch: session.epoch, invocationId: 'one-job' });
      const perform = () => {
        switch (operation) {
          case 'begin': return f.client.beginUpload(session, declaration, 'another-upload');
          case 'inspect': return f.client.inspectUpload(session, upload.uploadId);
          case 'chunk': return f.client.uploadChunk(session, upload.uploadId, 0n, bytes, chunkDigest, 'new-chunk');
          case 'commit': return f.client.commitUpload(session, upload.uploadId, 'new-commit');
          case 'abort': return f.client.abortUpload(session, upload.uploadId, 'abort');
          case 'blob-metadata': return f.client.inspectBlob(session, blob!.blobId);
          case 'blob-range': return f.client.readBlobRange(session, blob!.blobId, 0n, 2n);
        }
      };
      await expect(perform()).rejects.toMatchObject({ status: 403 });
      expect(f.storage.append).not.toHaveBeenCalled();
      expect(f.storage.read).not.toHaveBeenCalled();
      expect(f.storage.remove).not.toHaveBeenCalled();
      expect(f.prepare).not.toHaveBeenCalled();
    } finally { await f.server.close(); }
  },
);

it('session close reclaims staged uploads and committed blobs while preserving another session', async () => {
  const f = fixture();
  try {
    const session = await f.client.openSession({ buildDigest: digest, bindings: [], limits }, 'session');
    const other = await f.client.openSession({ buildDigest: digest, bindings: [], limits }, 'other-session');
    const declaration = { size: '0', digest: createHash('sha256').digest('hex') };
    const staged = await f.client.beginUpload(session, declaration, 'staged');
    const committed = await f.client.beginUpload(session, declaration, 'committed');
    await f.client.commitUpload(session, committed.uploadId, 'commit');
    const independent = await f.client.beginUpload(other, declaration, 'independent');
    await f.client.closeSession(session, 'close');
    expect(f.storage.remove.mock.calls.map(([id]) => id).sort()).toEqual([staged.uploadId, committed.uploadId].sort());
    expect(await f.client.inspectUpload(other, independent.uploadId)).toMatchObject({ state: 'open' });
    await f.client.closeSession(session, 'close');
    expect(f.storage.remove).toHaveBeenCalledTimes(2);
  } finally { await f.server.close(); }
});

it('session close attempts every upload retirement and preserves failed cleanup', async () => {
  const f = fixture();
  const session = await f.client.openSession({ buildDigest: digest, bindings: [], limits }, 'session');
  const declaration = { size: '0', digest: createHash('sha256').digest('hex') };
  const first = await f.client.beginUpload(session, declaration, 'first');
  const second = await f.client.beginUpload(session, declaration, 'second');
  f.storage.remove.mockImplementation(async id => { if (id === first.uploadId) throw new Error('storage retirement failed'); });
  await expect(f.client.closeSession(session, 'close')).rejects.toMatchObject({ status: 503 });
  expect(f.storage.remove.mock.calls.map(([id]) => id).sort()).toEqual([first.uploadId, second.uploadId].sort());
  expect(f.close).toHaveBeenCalledOnce();
  expect(await f.client.inspectSession(session)).toMatchObject({ state: 'closing' });
  await expect(f.server.close()).rejects.toThrow('Media server retirement failed');
});

it('session retirement cancels a stalled begin body before it can allocate an upload', async () => {
  const f = fixture();
  try {
    const session = await f.client.openSession({ buildDigest: digest, bindings: [], limits }, 'session');
    let entered!: () => void; const reading = new Promise<void>(resolve => { entered = resolve; });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() { entered(); }, cancel }, { highWaterMark: 0 });
    const beginning = f.server.fetch(new Request(`https://media.test/v1/sessions/${session.sessionId}/uploads`, {
      method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'application/json',
        'Execution-Protocol': '1', 'Execution-Epoch': session.epoch, 'Idempotency-Key': 'begin' },
    } as RequestInit));
    await reading;
    await f.client.closeSession(session, 'close');
    expect((await beginning).status).toBe(410);
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.storage.remove).not.toHaveBeenCalled();
  } finally { await f.server.close(); }
});

it('session retirement aborts an accepted append and drains its receipt before removing storage', async () => {
  const f = fixture();
  try {
    const session = await f.client.openSession({ buildDigest: digest, bindings: [], limits }, 'session');
    const bytes = Uint8Array.of(7); const hash = createHash('sha256').update(bytes).digest('hex');
    const upload = await f.client.beginUpload(session, { size: '1', digest: hash }, 'upload');
    let entered!: () => void; const writing = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const receipt = new Promise<void>(resolve => { release = resolve; });
    let aborted!: () => void; const retirement = new Promise<void>(resolve => { aborted = resolve; });
    // An admitted host operation may settle only after cooperative cancellation.
    // The close response must await that settlement, even after signaling it.
    const append = vi.fn(async (_id: string, _offset: bigint, _bytes: Uint8Array, signal: AbortSignal) => {
      signal.addEventListener('abort', aborted, { once: true }); entered(); await receipt;
    });
    Object.assign(f.storage, { append });
    const chunk = f.client.uploadChunk(session, upload.uploadId, 0n, bytes,
      'sha-256=:' + Buffer.from(hash, 'hex').toString('base64') + ':', 'chunk').catch(error => error);
    await writing;
    let closed = false;
    const closing = f.client.closeSession(session, 'close').then(() => { closed = true; });
    await retirement;
    expect(closed).toBe(false); expect(f.storage.remove).not.toHaveBeenCalled();
    release(); await closing;
    expect(await chunk).toMatchObject({ status: 410 });
    expect(f.storage.remove).toHaveBeenCalledWith(upload.uploadId);
  } finally { await f.server.close(); }
});

it('session retirement releases an unread blob response without allocating its contents', async () => {
  const f = fixture();
  try {
    const session = await f.client.openSession({ buildDigest: digest, bindings: [], limits }, 'session');
    const bytes = Uint8Array.of(7); const hash = createHash('sha256').update(bytes).digest('hex');
    const upload = await f.client.beginUpload(session, { size: '1', digest: hash }, 'upload');
    await f.client.uploadChunk(session, upload.uploadId, 0n, bytes,
      'sha-256=:' + Buffer.from(hash, 'hex').toString('base64') + ':', 'chunk');
    const blob = await f.client.commitUpload(session, upload.uploadId, 'commit');
    f.storage.read.mockClear();
    const range = await f.client.readBlobRange(session, blob.blobId, 0n, 0n);
    const reader = range.body!.getReader();
    let retired: unknown;
    void reader.closed.catch(error => { retired = error; });
    await f.client.closeSession(session, 'close');
    expect(f.contents.size).toBe(0); expect(f.storage.read).not.toHaveBeenCalled();
    await new Promise<void>(resolve => setImmediate(resolve));
    try { expect(retired).toMatchObject({ status: 410 }); }
    finally { await reader.cancel().catch(() => {}); }
    await expect(reader.read()).rejects.toMatchObject({ status: 410 });
  } finally { await f.server.close(); }
});
