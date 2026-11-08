import { expect, it, vi } from 'vitest';
import { createJobBinding, type JobFileRequest } from './job-binding.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [bytes('native')] };

it.each([false, true])('executes retained descriptor IO without upgrading a legacy filesystem to a retained namespace (readonly=%s)', async readOnly => {
 const credential = {};
 const close = vi.fn(async () => {});
 const acquire = vi.fn(async () => ({ identity: {}, close,
  read: async () => ({ done: false as const, value: Uint8Array.of(0, 255) }),
 }));
 const policy = { read: true, retainedRead: true, streamingRead: true, write: true, append: true, truncate: true, retainedResize: true, readOnly };
 const fs = { capabilities: policy };
 const scratch = vi.fn();
 const job = createJobBinding({ ...invocation, credential, fs,
  handles: { acquire }, maxHandles: 2, maxCallbacks: 6,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const call = (callbackId: string, operation: object) => input.access(credential, {
    sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId, fileId: 'resource', stage: 'native-access', ...operation,
   } as JobFileRequest);
   expect(await call('policy', { operation: 'capabilities', path: bytes('input') }))
    .toEqual({ ...policy, read: false, retainedRead: false, streamingRead: false, write: false, append: false, truncate: false, retainedResize: false });
   const opened = await call('descriptor', { operation: 'descriptor-acquire', fd: 3, rights: ['read'] }) as { handle: string };
   expect(acquire).toHaveBeenCalledWith(3, ['read'], expect.any(AbortSignal));
   expect(await call('read', { operation: 'descriptor-read', handle: opened.handle, maxBytes: 8 }))
    .toEqual({ done: false, value: Uint8Array.of(0, 255) });
   const denied = { operation: 'open', path: bytes('input') };
   await expect(call('open', denied)).rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'open' });
   await expect(call('open', denied)).rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'open' });
   await expect(call('create', { operation: 'create', path: bytes('output'), flag: 'w' }))
    .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'create' });
   await call('close', { operation: 'descriptor-close', handle: opened.handle });
   return { exitCode: 1 };
  },
 });
 // Adding a scratch facet after issue cannot qualify pathname IO.
 Object.assign(fs, { objects: { open: scratch, create: scratch } });
 expect(await job.execute(invocation, new AbortController().signal)).toEqual({ exitCode: 1 });
 expect(scratch).not.toHaveBeenCalled();
 expect(close).toHaveBeenCalledOnce();
 expect(policy.read).toBe(true);
});

it('acknowledges delayed partial descriptor writes on a readonly pathname backend and retains them after native failure', async () => {
 const credential = {};
 let release!: () => void;
 const delayed = new Promise<void>(resolve => { release = resolve; });
 let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const content: number[] = [];
 const close = vi.fn(async () => {});
 const quota = Object.assign(new Error('canonical quota'), { code: 'EDQUOT', syscall: 'write' });
 const write = vi.fn(async (value: Uint8Array) => {
  if (content.length) throw quota;
  entered(); await delayed;
  content.push(value[0]); return 1;
 });
 const job = createJobBinding({ ...invocation, credential, fs: { capabilities: { readOnly: true } },
  handles: { acquire: async () => ({ identity: {}, write, close }) }, maxHandles: 1, maxCallbacks: 3,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const call = (callbackId: string, operation: object) => input.access(credential, {
    sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId, fileId: 'stdout', stage: 'native-write', ...operation,
   } as JobFileRequest);
   const opened = await call('descriptor', { operation: 'descriptor-acquire', fd: 1, rights: ['write'] }) as { handle: string };
   let acknowledged = false;
   const value = Uint8Array.of(0, 255);
   const writing = call('write', { operation: 'descriptor-write', handle: opened.handle, bytes: value }).then(count => { acknowledged = true; return count; });
   await started; value.fill(9);
   expect(acknowledged).toBe(false); expect(content).toEqual([]);
   release(); expect(await writing).toBe(1); expect(content).toEqual([0]);
   await expect(call('quota', { operation: 'descriptor-write', handle: opened.handle, bytes: Uint8Array.of(255) })).rejects.toBe(quota);
   return { exitCode: 1 };
  },
 });
 expect(await job.execute(invocation, new AbortController().signal)).toEqual({ exitCode: 1 });
 expect(content).toEqual([0]); expect(write).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledOnce();
});
