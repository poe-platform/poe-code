import { expect, it, vi } from 'vitest';
import { createMediaServer, type SessionAuthority } from './media-server.js';
import type { Build, Grant, JobRequest, Limits, Session } from './wire.generated.js';
import type { AdmissionRecord } from './admissions.js';
import type { ProcessStreams } from './native-process.js';

const digest = 'a'.repeat(64);
const limits: Limits = { maxJobs: 2, maxHandles: 4, maxArgvBytes: 64, maxManifestEntries: 8,
  maxFrameBytes: 4096, maxInflightBytes: 8192, maxBlobBytes: 8192, maxReplayBytes: 65536,
  maxCallbacks: 8, maxNativeMemoryBytes: 8192, maxNativeProcesses: 4, maxJobDurationMs: 10000 };
const build: Build = { digest, imageDigest: 'sha256:' + digest, os: 'linux', architecture: 'x86_64',
  executables: { tool: digest }, librariesDigest: digest, inventoryDigest: digest, assetsDigest: digest,
  launcherRevision: 'launcher', bridgeRevision: 'bridge', runtimeRequirements: [], runtimeEnvironment: {},
  policyDigest: digest, configDigest: digest, policyDifferences: [],
  inventory: { codecs: [], coders: [], delegates: [], fonts: [], profiles: [] } };
const grant: Grant = { grantId: 'host', namespaceId: 'work', root: '/', operations: ['stat'],
  maxBytes: '64', maxOperations: 4, expiresAt: new Date(100000).toISOString() };

function fixture(authority: SessionAuthority) {
  const records = new Map<string, AdmissionRecord>();
  const admissions = { record: vi.fn(async (_record: AdmissionRecord) => {}),
    inspect: vi.fn(async (id: string) => structuredClone(records.get(id) ?? null)) };
  const server = createMediaServer({ authenticate: async () => ({ tenantId: 'tenant', principalId: 'owner', expiresAt: 100000 }),
    builds: [build], tools: [{ id: 'tool', buildDigest: digest, executable: '/tools/tool', requiredFeatures: ['live-files'] }],
    driver: { features: [{ name: 'live-files', evidence: ['in-memory fixture'] }],
      async inspectBuild() { return structuredClone(build); }, async admitSession() { return authority; } },
    admissions: { inspect: admissions.inspect, async record(value) {
      await admissions.record(value); records.set(value.operationId, structuredClone(value));
    } }, storage: { async append() {}, async read() { return new Uint8Array(); }, async remove() {} },
    limits, leaseMs: 10000, retentionMs: 20000, maxDocumentBytes: 16384, maxRecords: 32, now: () => 1000 });
  let session: Session;
  async function request(path: string, body: unknown, key = path) {
    return server.fetch(new Request('https://media.test/v1/' + path, { method: 'POST',
      headers: { Authorization: 'Bearer fixture', 'Execution-Protocol': '1', 'Execution-Epoch': session?.epoch ?? '',
        'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  }
  return { server, admissions, request, async open() {
    const response = await request('sessions', { buildDigest: digest, bindings: [{ namespaceId: 'work',
      logicalRoot: '/', rights: ['read', 'write', 'metadata'], grantId: 'host', profile: 'live' }], limits });
    expect(response.status).toBe(200); session = await response.json() as Session; return session;
  } };
}

it('keeps canonical file methods and their receivers while file contents remain live', async () => {
  let content = 1;
  const close = vi.fn(async () => {});
  const files: NonNullable<SessionAuthority['files']> = {
    open: vi.fn(async function (this: unknown) {
      expect(this).toBe(files);
      return { async stat() { return { size: 1n, type: 'file' as const }; },
        async read() { return Uint8Array.of(content); }, close };
    }),
    list: vi.fn(async function (this: unknown) { expect(this).toBe(files); return []; }),
  };
  const originalOpen = files.open; const originalList = files.list;
  const authority: SessionAuthority = { files, prepare: vi.fn(), close: vi.fn(async () => {}) };
  const f = fixture(authority); const s = await f.open();
  const substituted = vi.fn(async () => { throw new Error('unadmitted filesystem'); });
  files.open = substituted; files.list = substituted;
  authority.files = { open: substituted, list: substituted };
  content = 9;
  try {
    const opened = await f.request(`sessions/${s.sessionId}/file-handles`, { namespaceId: 'work', grantId: 'host', path: '/x' });
    expect(opened.status).toBe(200);
    const { handleId } = await opened.json();
    const read = await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/file-handles/${handleId}/bytes`, {
      headers: { Authorization: 'Bearer fixture', 'Execution-Protocol': '1', 'Execution-Epoch': s.epoch } }));
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(Uint8Array.of(9));
    expect((await f.request(`sessions/${s.sessionId}/file-listings`, { namespaceId: 'work', grantId: 'host', path: '/', maxEntries: 8 })).status).toBe(200);
    expect(originalOpen).toHaveBeenCalledOnce(); expect(originalList).toHaveBeenCalledOnce();
    expect(substituted).not.toHaveBeenCalled();
  } finally { await f.server.close(); }
  expect(close).toHaveBeenCalledOnce();
});

it('does not let borrowed grants widen invocation authority after session admission', async () => {
  const host = structuredClone(grant);
  const authority: SessionAuthority = { grants: [host], prepare: vi.fn(), close: vi.fn(async () => {}) };
  const f = fixture(authority); const s = await f.open();
  host.operations.push('unlink'); host.maxBytes = '128';
  const invocation: JobRequest = { buildDigest: digest, toolId: 'tool', args: [], namespaceId: 'work',
    materializationRevision: null, cwd: '/', env: {}, stdin: { kind: 'stream', seekable: false },
    descriptors: [], grants: [host], freshness: 'live', limits };
  try {
    expect((await f.request(`sessions/${s.sessionId}/jobs`, invocation)).status).toBe(403);
    expect(authority.prepare).not.toHaveBeenCalled();
    expect(f.admissions.record.mock.calls.flat().some(value => value.kind === 'job')).toBe(false);
  } finally { await f.server.close(); }
});

it('retires the acquired session through its original owner after method replacement', async () => {
  const authority: SessionAuthority = { prepare: vi.fn(), close: vi.fn(async function (this: unknown) { expect(this).toBe(authority); }) };
  const close = authority.close; const replacement = vi.fn(async () => {});
  const f = fixture(authority); await f.open(); authority.close = replacement;
  await f.server.close();
  expect(close).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
});

it('retires acquired authority when an optional facet getter fails during admission', async () => {
  const close = vi.fn(async () => {});
  const authority: SessionAuthority = { prepare: vi.fn(), close };
  Object.defineProperty(authority, 'dependencies', { get() { throw new Error('facet acquisition failed'); } });
  const f = fixture(authority);
  const response = await f.request('sessions', { buildDigest: digest, bindings: [], limits });
  expect(response.status).toBe(503);
  expect(close).toHaveBeenCalledOnce();
  await f.server.close(); expect(close).toHaveBeenCalledOnce();
});

it('rejects excess host grants before inspecting or copying their metadata', async () => {
  const inspect = vi.fn(() => { throw new Error('grant metadata must remain unread'); });
  const grants = new Array<Grant>(33);
  Object.defineProperty(grants, 0, { get: inspect });
  const close = vi.fn(async () => {});
  const f = fixture({ grants, close, prepare: vi.fn() });
  const response = await f.request('sessions', { buildDigest: digest, bindings: [], limits });
  expect(response.status).toBe(413); expect(inspect).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  await f.server.close(); expect(close).toHaveBeenCalledOnce();
});

it('keeps the acquired invocation launcher and cleanup owner across durable publication', async () => {
  const replacedStart = vi.fn(() => { throw new Error('unadmitted launcher'); });
  const replacedClose = vi.fn(async () => {});
  const prepared: import('./media-server.js').PreparedInvocation = {
    start: vi.fn(function (this: unknown, streams: ProcessStreams) {
      expect(this).toBe(prepared);
      return { exit: Promise.resolve({ kind: 'exited' as const, exitCode: 23 }),
        settled: Promise.all([streams.end(2), streams.end(3)]).then(() => {}),
        async write() {}, async end() {}, signal() {} };
    }),
    close: vi.fn(async function (this: unknown) { expect(this).toBe(prepared); }),
  };
  const start = prepared.start; const close = prepared.close;
  const authority: SessionAuthority = { prepare: vi.fn(async function (this: unknown) {
    expect(this).toBe(authority); return prepared;
  }), close: vi.fn(async () => {}) };
  const prepare = authority.prepare; const replacedPrepare = vi.fn();
  const f = fixture(authority); const s = await f.open(); authority.prepare = replacedPrepare;
  f.admissions.record.mockImplementation(async record => {
    if (record.jobState?.stage === 'running') { prepared.start = replacedStart; prepared.close = replacedClose; }
  });
  try {
    const response = await f.request(`sessions/${s.sessionId}/jobs`, { buildDigest: digest, toolId: 'tool', args: [],
      namespaceId: 'work', materializationRevision: null, cwd: '/', env: {}, stdin: { kind: 'stream', seekable: false },
      descriptors: [], grants: [], freshness: 'live', limits });
    expect(response.status).toBe(200);
    const { jobId } = await response.json();
    const wait = await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${jobId}/wait`, {
      headers: { Authorization: 'Bearer fixture', 'Execution-Protocol': '1', 'Execution-Epoch': s.epoch } }));
    expect(wait.status).toBe(200);
    expect(await wait.json()).toMatchObject({ state: 'terminal', outputComplete: true, cleanup: 'complete',
      processOutcome: { kind: 'exited', exitCode: 23 }, outcome: { kind: 'exited', exitCode: 23 } });
    expect(prepare).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
    expect(replacedPrepare).not.toHaveBeenCalled(); expect(replacedStart).not.toHaveBeenCalled(); expect(replacedClose).not.toHaveBeenCalled();
  } finally { await f.server.close(); }
});
