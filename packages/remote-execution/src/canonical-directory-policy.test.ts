import { expect, it, vi } from 'vitest';
import { createJobBinding } from './job-binding.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it('preserves structural mount policy accessors before empty-directory removal', async () => {
 const credential = {};
 const snapshotRmdir = vi.fn(() => true);
 const policy = Object.create({ get snapshotRmdir() { return snapshotRmdir(); } });
 const rmdir = vi.fn(async () => {});
 const job = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: vi.fn() }, rmdir, capabilitiesFor: async () => policy },
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'remove', fileId: 'directory', stage: 'native-rmdir', operation: 'rmdir', path: bytes('directory') }))
    .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'rmdir', path: '/work/directory' });
   return { exitCode: 1 };
  },
 });
 await job.execute(invocation, new AbortController().signal);
 expect(snapshotRmdir).toHaveBeenCalledOnce();
 expect(rmdir).not.toHaveBeenCalled();
});

it.each(['replace', 'mutate'] as const)('retains the issued directory policy authority while observing live policy (%s)', async change => {
 const credential = {};
 const capabilities = { snapshotRmdir: change === 'replace' };
 const rmdir = vi.fn(async () => {});
 const fs = { objects: { open: vi.fn() }, capabilities, rmdir };
 const job = createJobBinding({ ...invocation, credential, fs, maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'remove', fileId: 'directory', stage: 'native-rmdir', operation: 'rmdir', path: bytes('directory') }))
    .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'rmdir', path: '/work/directory' });
   return { exitCode: 1 };
  },
 });
 if (change === 'replace') fs.capabilities = { snapshotRmdir: false };
 else capabilities.snapshotRmdir = true;
 await job.execute(invocation, new AbortController().signal);
 expect(rmdir).not.toHaveBeenCalled();
});

it.each([null, [], { snapshotRmdir: 'false' }, { removeDirectory: 1 }])('refuses malformed selected-mount directory policy before mutation (%j)', async policy => {
 const credential = {};
 const rmdir = vi.fn(async () => {});
 const job = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: vi.fn() }, capabilities: { snapshotRmdir: false }, rmdir, capabilitiesFor: async () => policy } as never,
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'remove', fileId: 'directory', stage: 'native-rmdir', operation: 'rmdir', path: bytes('directory') }))
    .rejects.toMatchObject({ code: 'EIO', syscall: 'rmdir', path: '/work/directory' });
   return { exitCode: 1 };
  },
 });
 await job.execute(invocation, new AbortController().signal);
 expect(rmdir).not.toHaveBeenCalled();
});

it('uses one admitted observation of selected-mount directory policy', async () => {
 const credential = {};
 let observations = 0;
 const policy = { get snapshotRmdir() { return ++observations === 1; } };
 const rmdir = vi.fn(async () => {});
 const job = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: vi.fn() }, rmdir, capabilitiesFor: async () => policy },
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'remove', fileId: 'directory', stage: 'native-rmdir', operation: 'rmdir', path: bytes('directory') }))
    .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'rmdir', path: '/work/directory' });
   return { exitCode: 1 };
  },
 });
 await job.execute(invocation, new AbortController().signal);
 expect(observations).toBe(1);
 expect(rmdir).not.toHaveBeenCalled();
});
