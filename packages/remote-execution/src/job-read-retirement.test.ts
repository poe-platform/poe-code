import { expect, it, vi } from 'vitest';
import { createJobBinding, type JobFileRequest } from './job-binding.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
const tick = () => new Promise<void>(resolve => { setImmediate(resolve); });

it.each(['file', 'descriptor'] as const)('native %s close retires an idle read before draining its callback queue', async kind => {
 const credential = {};
 let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 let release!: () => void;
 const read = vi.fn(async (_count: number, signal: AbortSignal) => {
  entered();
  return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
   release = () => resolve({ done: true, value: undefined });
   signal.addEventListener('abort', () => reject(signal.reason), { once: true });
   if (signal.aborted) reject(signal.reason);
  });
 });
 const close = vi.fn(async () => {});
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 4,
  fs: { objects: { open: async () => ({ identity: {}, type: 'file', stat: async () => ({ type: 'file', size: 0n }),
   read: async (_position, count, options) => { await read(count, options!.signal!); return new Uint8Array(); }, close }) } },
  handles: { acquire: async () => ({ identity: {}, read, close }) },
  prepare: async input => ({ ...input, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const access = (request: object, callbackId: string) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'input', stage: 'native-read', callbackId, ...request } as JobFileRequest);
   const opened = await access(kind === 'file' ? { operation: 'open', path: bytes('input') }
    : { operation: 'descriptor-acquire', fd: 3, rights: ['read'] }, 'open') as { handle: string };
   let readSettled = false;
   const reading = access({ operation: kind === 'file' ? 'read' : 'descriptor-read', handle: opened.handle, position: '0', maxBytes: 1 }, 'read').then(value => ({ value }), cause => ({ cause })).finally(() => { readSettled = true; });
   await started;
   const foreign = access({ operation: kind === 'file' ? 'close' : 'descriptor-close', handle: opened.handle, fileId: 'foreign' }, 'foreign').then(value => ({ value }), cause => ({ cause }));
   await tick();
   const foreignRetiredRead = readSettled;
   let settled = false;
   const closing = access({ operation: kind === 'file' ? 'close' : 'descriptor-close', handle: opened.handle }, 'close').then(() => { settled = true; });
   await tick();
   const observation = settled;
   // Always release the fixture, including on the red implementation.
   release();
   await closing;
   const result = await reading;
   expect(await foreign).toMatchObject({ cause: { code: 'EBADF' } });
   expect(foreignRetiredRead).toBe(false);
   expect(observation).toBe(true);
   expect(result).toMatchObject({ cause: { code: 'EBADF' } });
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(close).toHaveBeenCalledOnce();
});

it.each(['exited', 'failed'] as const)('job %s retires idle descriptor reads while preserving delayed accepted writes', async outcome => {
 const credential = {};
 let readEntered!: () => void; const reading = new Promise<void>(resolve => { readEntered = resolve; });
 let writeEntered!: () => void; const writing = new Promise<void>(resolve => { writeEntered = resolve; });
 let releaseRead!: () => void; let releaseWrite!: () => void;
 let retired = false; let visible = 0;
 const close = vi.fn(async () => {});
 const failure = new Error('native failed');
 const identity = {};
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 2, maxCallbacks: 4,
  fs: { objects: { open: vi.fn() } },
  handles: { acquire: async fd => ({ identity, close,
   ...(fd === 3 ? { read: async (_count: number, signal: AbortSignal) => {
    readEntered();
    return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
     releaseRead = () => resolve({ done: true, value: undefined });
     signal.addEventListener('abort', () => { retired = true; reject(signal.reason); }, { once: true });
     if (signal.aborted) { retired = true; reject(signal.reason); }
    });
   } } : { write: async (_bytes: Uint8Array, signal: AbortSignal) => {
    writeEntered(); await new Promise<void>(resolve => { releaseWrite = resolve; });
    signal.throwIfAborted(); visible = 1; return 1;
   } }),
  }) },
  prepare: async input => ({ ...input, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const access = (request: object, callbackId: string) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'fd', stage: 'native-io', callbackId, ...request } as JobFileRequest);
   const reader = await access({ operation: 'descriptor-acquire', fd: 3, rights: ['read'] }, 'reader') as { handle: string };
   const writer = await access({ operation: 'descriptor-acquire', fd: 4, rights: ['write'] }, 'writer') as { handle: string };
   void access({ operation: 'descriptor-read', handle: reader.handle, maxBytes: 1 }, 'read').catch(() => {});
   void access({ operation: 'descriptor-write', handle: writer.handle, bytes: Uint8Array.of(255) }, 'write').catch(() => {});
   await reading;
   if (outcome === 'failed') throw failure;
   return { exitCode: 1 };
  },
 });
 let settled = false;
 const execution = runtime.execute(invocation, new AbortController().signal).then(value => ({ value }), cause => ({ cause })).finally(() => { settled = true; });
 await reading; await tick();
 const observation = retired;
 releaseRead(); await writing;
 const settledBeforeWrite = settled;
 releaseWrite();
 const result = await execution;
 expect(observation).toBe(true);
 expect(settledBeforeWrite).toBe(false);
 expect(visible).toBe(1);
 expect(close).toHaveBeenCalledTimes(2);
 if (outcome === 'failed') expect(result).toEqual({ cause: failure });
 else expect(result).toEqual({ value: { exitCode: 1 } });
});
