import { expect, it } from 'vitest';
import { createDescriptorMaterialization } from './descriptors.js';
import { createJobBinding, type JobFileRequest } from './job-binding.js';
import { admitCanonicalMetadata } from './canonical-metadata.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
const invalid = [{ size: -1 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { size: 0.5 }, { atimeMs: NaN }, { mtimeMs: Infinity }, { mode: -1 }, { allocatedBytes: -1 }, { uid: 4294967296 }, { revision: 0.5 }, { type: 'unknown' },
 { mode: undefined }, { atimeMs: undefined }, { mtimeMs: undefined }, { ctimeMs: undefined }];

it.each(['stat', 'lstat'] as const)('captures contract metadata from prototype accessors at %s', syscall => {
 let observations = 0;
 const stat = Object.create({ type: 'directory', size: 0, mode: 0o40755,
  get atimeMs() { observations++; return 1.5; }, mtimeMs: 2, ctimeMs: 3,
  allocatedBytes: 0, nlink: 2 });
 expect(admitCanonicalMetadata(stat, syscall)).toEqual({ type: 'directory', size: 0, mode: 0o40755,
  atimeMs: 1.5, mtimeMs: 2, ctimeMs: 3, allocatedBytes: 0, nlink: 2 });
 expect(observations).toBe(1);
});

it('never observes private identity or extension payloads when admitting remote metadata', () => {
 const stat = { type: 'file' as const, size: 1, mode: 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
 for (const key of ['identityScope', 'dev', 'ino', 'extension']) {
  Object.defineProperty(stat, key, { enumerable: true, get() { throw new Error('private backend payload'); } });
 }
 expect(admitCanonicalMetadata(stat, 'stat')).toEqual({ type: 'file', size: 1, mode: 0o644,
  atimeMs: 0, mtimeMs: 0, ctimeMs: 0 });
});

it('preserves sparse allocation and fractional signed timestamps from one live observation', () => {
 let atime = -0.5; let observations = 0;
 const stat = { type: 'file' as const, size: Number.MAX_SAFE_INTEGER, allocatedBytes: 4096,
  preferredIoBlockSize: 4096, mode: 0o100644, uid: 4294967295, gid: 0, nlink: 0, revision: 1,
  get atimeMs() { observations++; return atime; }, mtimeMs: -1.25, ctimeMs: 0, birthtimeMs: -2.5,
  identityScope: Symbol('private'), dev: 1, ino: 2 };
 const first = admitCanonicalMetadata(stat, 'stat');
 expect(observations).toBe(1);
 expect(first).toEqual({ type: 'file', size: Number.MAX_SAFE_INTEGER, allocatedBytes: 4096,
  preferredIoBlockSize: 4096, mode: 0o100644, uid: 4294967295, gid: 0, nlink: 0, revision: 1,
  atimeMs: -0.5, mtimeMs: -1.25, ctimeMs: 0, birthtimeMs: -2.5 });
 atime = 10.5;
 expect(admitCanonicalMetadata(stat, 'lstat').atimeMs).toBe(10.5);
 expect(first.atimeMs).toBe(-0.5);
 expect(observations).toBe(2);
});

it.each(invalid)('refuses invalid canonical metadata %j at pathname and descriptor stat stages', async change => {
 const stat = { type: 'file' as const, size: 1, mode: 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, ...change };
 const signal = new AbortController().signal;
 const descriptors = createDescriptorMaterialization({ handles: { acquire: async () => ({ identity: {}, stat: async () => stat as never, close: async () => {} }) }, maxHandles: 1, maxIoBytes: 1 });
 try {
  const opened = await descriptors.acquire(3, ['stat'], signal);
  await expect(descriptors.stat(opened.handle, signal)).rejects.toMatchObject({ code: 'EIO', syscall: 'stat' });
 } finally { await descriptors.dispose(); }
 const credential = {};
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: async () => { throw new Error('stat must not acquire content'); } }, stat: async () => stat as never, lstat: async () => stat as never },
  maxHandles: 1, maxCallbacks: 2,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   for (const operation of ['path-stat', 'path-lstat'] as const) {
    const request: JobFileRequest = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: operation, fileId: 'input', stage: 'native-metadata', operation, path: bytes('input') };
    await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'EIO', syscall: operation === 'path-stat' ? 'stat' : 'lstat' });
   }
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, signal);
});
