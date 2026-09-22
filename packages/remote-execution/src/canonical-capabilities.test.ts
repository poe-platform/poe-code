import { expect, it, vi } from 'vitest';
import { createJobBinding } from './job-binding.js';
import { admitCanonicalCapabilities } from './canonical-capabilities.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['é', '"', '\\', '\n'])('counts exact UTF-8 and JSON escaping in capability metadata (%j)', name => {
 const policy = { [name]: false, read: true, absent: undefined };
 const length = new TextEncoder().encode(JSON.stringify(policy)).length;
 expect(admitCanonicalCapabilities(policy, 'capabilities', '/mount', length)).toEqual(policy);
 expect(() => admitCanonicalCapabilities(policy, 'capabilities', '/mount', length - 1))
  .toThrow(expect.objectContaining({ code: 'EFBIG', syscall: 'capabilities', path: '/mount' }));
});

it('bounds capability extension metadata and retains the original refusal on replay', async () => {
 const credential = {};
 const capabilitiesFor = vi.fn(async () => ({ ['extension'.repeat(32)]: true }));
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 1, maxIoBytes: 64,
  fs: { objects: { open: vi.fn() }, capabilitiesFor },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'mount',
    stage: 'native-policy', operation: 'capabilities' as const, path: bytes('mount') };
   for (let attempt = 0; attempt < 2; attempt++) {
    await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'EFBIG', syscall: 'capabilities', path: '/work/mount' });
   }
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(capabilitiesFor).toHaveBeenCalledOnce();
});

it('bounds the final capability reply after unsupported guarantees are narrowed', async () => {
 const credential = {};
 const policy = { copy: true };
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 1,
  maxIoBytes: new TextEncoder().encode(JSON.stringify(policy)).length,
  fs: { objects: { open: vi.fn() }, capabilitiesFor: async () => policy },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'mount',
    stage: 'native-policy', operation: 'capabilities', path: bytes('mount') }))
    .rejects.toMatchObject({ code: 'EFBIG', syscall: 'capabilities', path: '/work/mount' });
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(policy).toEqual({ copy: true });
});

it('observes live structural read-only mount guarantees once per canonical query', async () => {
 const credential = {}; let readOnly = true;
 const observation = vi.fn(() => readOnly);
 const policy = Object.create({ get readOnly() { return observation(); }, write: true, rename: true });
 const operation = vi.fn();
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: operation, create: operation, rename: operation }, capabilitiesFor: async () => policy },
  maxHandles: 1, maxCallbacks: 2,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'mount', stage: 'native-policy', operation: 'capabilities' as const, path: bytes('mount') };
   const first = await input.access(credential, { ...request, callbackId: 'first' });
   expect(first).toEqual({ readOnly: true, write: false, rename: false });
   readOnly = false;
   expect(await input.access(credential, { ...request, callbackId: 'second' })).toEqual({ readOnly: false, write: true, rename: true });
   expect(first).toEqual({ readOnly: true, write: false, rename: false });
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(observation).toHaveBeenCalledTimes(2);
 expect(operation).not.toHaveBeenCalled();
});

it('uses the admitted global capability facet when the canonical filesystem has no per-path query', async () => {
 const credential = {};
 const open = vi.fn();
 const rename = vi.fn();
 const capabilities = { readOnly: false, rename: true, atomicRename: true, copy: true };
 const fs = { objects: { open, rename }, capabilities };
 const runtime = createJobBinding({ ...invocation, credential, fs,
  maxHandles: 1, maxCallbacks: 2,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'mount', stage: 'native-policy', operation: 'capabilities' as const, path: bytes('mount') };
   const first = await input.access(credential, { ...request, callbackId: 'first' });
   expect(first).toEqual({ ...capabilities, copy: false });
   capabilities.readOnly = true;
   expect(await input.access(credential, { ...request, callbackId: 'second' })).toEqual({ readOnly: true, rename: false, atomicRename: false, copy: false });
   expect(first).toEqual({ readOnly: false, rename: true, atomicRename: true, copy: false });
   return { exitCode: 0 };
  },
 });
 // Replacing the facet must not substitute authority already issued to the job.
 fs.capabilities = { ...capabilities, rename: false };
 await runtime.execute(invocation, new AbortController().signal);
 expect(open).not.toHaveBeenCalled();
 expect(rename).not.toHaveBeenCalled();
});

it('propagates a per-path policy denial instead of falling back to global capabilities', async () => {
 const credential = {};
 const denied = Object.assign(new Error('mount policy denied'), { code: 'EACCES', syscall: 'capabilities' });
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: vi.fn() }, capabilities: { read: true }, capabilitiesFor: async () => { throw denied; } },
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'mount', stage: 'native-policy', operation: 'capabilities', path: bytes('mount') })).rejects.toBe(denied);
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
});

it.each([false, true])('requires canonical creation for advertised write and append routes (create=%s)', async available => {
 const credential = {};
 const operation = vi.fn();
 const advertised = { write: true, append: true, streamingWrite: true, streamingAppend: true, descriptorWriteStream: true,
  read: true, readOnly: false };
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: operation, ...(available ? { create: operation } : {}) }, capabilitiesFor: async () => advertised },
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   expect(await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'out',
    stage: 'native-policy', operation: 'capabilities', path: bytes('out'), create: true }))
    .toEqual({ ...advertised, write: available, append: available, streamingWrite: available, streamingAppend: available, descriptorWriteStream: available });
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(operation).not.toHaveBeenCalled();
 expect(advertised.write).toBe(true);
});

it('does not advertise compound operations absent from the canonical callback contract', async () => {
 const credential = {};
 const advertised = { copy: true, exclusiveCopy: true, recursiveMkdir: true, recursiveRemove: true, atomicFileStaging: true, atomicFileMutation: true, atomicDirectoryMetadata: true, atomicResize: true };
 const operation = vi.fn();
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: operation, create: operation, rename: operation, unlink: operation }, mkdir: operation, capabilitiesFor: async () => advertised } as never,
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   expect(await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'out', stage: 'native-policy', operation: 'capabilities', path: bytes('mount/out') }))
    .toEqual(Object.fromEntries(Object.keys(advertised).map(key => [key, false])));
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(operation).not.toHaveBeenCalled();
 expect(Object.values(advertised).every(value => value === true)).toBe(true);
});

it.each([undefined, false, true])('does not promote legacy offset-replacement eligibility into retained positional IO (claim=%s)', async claim => {
 const credential = {};
 const operation = vi.fn();
 const advertised = { randomAccessWrite: claim };
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: operation, create: operation }, capabilitiesFor: async () => advertised },
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   expect(await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'out',
    stage: 'native-policy', operation: 'capabilities', path: bytes('out') }))
    .toEqual({ randomAccessWrite: claim === true ? false : claim });
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(operation).not.toHaveBeenCalled();
 expect(advertised.randomAccessWrite).toBe(claim);
});

it.each([false, true])('reports namespace capabilities only when canonical guarantees and executable methods agree (methods=%s)', async available => {
 const credential = {};
 const open = vi.fn();
 const operation = vi.fn();
 const advertised = { readOnly: false, read: true, readdir: true, exclusiveCreate: true, rename: true, atomicRename: true, mkdir: true, remove: true, removeDirectory: true, readlink: true, symlinks: true, atomicRenameNoReplace: true };
 const capabilitiesFor = vi.fn(async () => advertised);
 const fs = { objects: { open, ...(available ? { create: operation, rename: operation, unlink: operation, readdir: operation } : {}) }, capabilitiesFor,
  ...(available ? { mkdir: operation, rmdir: operation, readlink: operation, symlink: operation } : {}) };
 const runtime = createJobBinding({ ...invocation, credential, fs: fs as never, maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const result = await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'out', stage: 'native-policy', operation: 'capabilities', path: bytes('mount/out'), create: true });
   expect(result).toEqual({ ...advertised, readdir: available, exclusiveCreate: available, rename: available, atomicRename: available, mkdir: available, remove: available, removeDirectory: available, readlink: available, symlinks: available, atomicRenameNoReplace: false });
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(capabilitiesFor).toHaveBeenCalledWith('/work/mount/out', { create: true, signal: expect.any(AbortSignal) });
 expect(advertised.atomicRenameNoReplace).toBe(true);
 expect(open).not.toHaveBeenCalled();
 expect(operation).not.toHaveBeenCalled();
});

it('rechecks live mount guarantees without promoting unknown support or exposing snapshot rmdir', async () => {
 const credential = {};
 const operation = vi.fn();
 let policy = { readOnly: false, rename: false, readdir: undefined, removeDirectory: true, snapshotRmdir: false };
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: operation, rename: operation, readdir: operation }, rmdir: operation, capabilitiesFor: async () => policy } as never,
  maxHandles: 1, maxCallbacks: 2,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'mount', stage: 'native-policy', operation: 'capabilities' as const, path: bytes('mount'), allowDirectory: true };
   const first = await input.access(credential, { ...request, callbackId: 'first' });
   expect(first).toEqual(policy);
   policy = { ...policy, readOnly: true, snapshotRmdir: true };
   expect(await input.access(credential, { ...request, callbackId: 'second' })).toEqual({ ...policy, removeDirectory: false });
   expect(first).toEqual({ readOnly: false, rename: false, readdir: undefined, removeDirectory: true, snapshotRmdir: false });
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(operation).not.toHaveBeenCalled();
});
