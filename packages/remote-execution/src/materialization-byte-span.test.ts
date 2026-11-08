import { expect, it, vi } from 'vitest';
import { BytePath } from '@poe-code/safe-fs/contracts/object';
import { createFileServer } from './files.js';
import { createJobBinding, type JobFileRequest } from './job-binding.js';
import { uploadDescriptor } from './upload-descriptor.js';

it.each(['write', 'append'] as const)('admits indexed %s octets without invoking a transport iterator', async operation => {
 const b = (text: string) => Array.from(new TextEncoder().encode(text));
 const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: b('/work'), originalArgv: [] };
 const credential = {}; const identity = {};
 const write = vi.fn(async (_position: bigint, bytes: Uint8Array) => bytes.length);
 const append = vi.fn(async (bytes: Uint8Array) => bytes.length);
 const iterator = vi.fn(() => { throw new Error('transport iterator is not octet authority'); });
 const bytes = [255];
 Object.defineProperty(bytes, Symbol.iterator, { value: iterator });
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 2, maxIoBytes: 1,
  fs: { objects: { open: async () => ({ identity, type: 'file', stat: async () => ({ type: 'file', size: 0n }), write, append, close: async () => {} }) } },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const base = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'file', stage: 'native-write' };
   const opened = await input.access(credential, { ...base, callbackId: 'open', operation: 'open', path: b('file'), access: 'write' }) as { handle: string };
   expect(await input.access(credential, { ...base, callbackId: 'write', operation, handle: opened.handle, position: '0', bytes })).toBe(1);
   expect(iterator).not.toHaveBeenCalled();
   expect(operation === 'write' ? write.mock.calls[0]?.[1] : append.mock.calls[0]?.[0]).toEqual(Uint8Array.of(255));
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
});

it.each(['write', 'append', 'descriptor-write'] as const)('refuses oversized %s frames before cloning callback metadata', async operation => {
 const b = (text: string) => Array.from(new TextEncoder().encode(text));
 const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: b('/work'), originalArgv: [] };
 const credential = {};
 const bytes = Uint8Array.of(1, 2);
 Object.defineProperty(bytes, 'length', { value: 1 });
 Object.defineProperty(bytes, 'byteLength', { value: 1 });
 const cloneMetadata = vi.fn(() => { throw new Error('oversized frame reached cloning'); });
 const open = vi.fn();
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 1, maxIoBytes: 1,
  fs: { objects: { open } },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'write', fileId: 'file', stage: 'native-write', operation, handle: 'unopened', position: '0', bytes };
   Object.defineProperty(request, 'extra', { enumerable: true, get: cloneMetadata });
   await expect(input.access(credential, request as JobFileRequest)).rejects.toMatchObject({ code: 'EINVAL' });
   expect(cloneMetadata).not.toHaveBeenCalled();
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(open).not.toHaveBeenCalled();
});

it.each([{ bytes: [256] }, { bytes: new Array<number>(1) }])('refuses malformed indexed octets before copying despite an empty iterator (%j)', async ({ bytes }) => {
 const b = (text: string) => Array.from(new TextEncoder().encode(text));
 const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: b('/work'), originalArgv: [] };
 const credential = {};
 Object.defineProperty(bytes, Symbol.iterator, { value: function* () {} });
 const cloneMetadata = vi.fn(() => { throw new Error('invalid octets reached cloning'); });
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 1, maxIoBytes: 1,
  fs: { objects: { open: vi.fn() } },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'write', fileId: 'file', stage: 'native-write', operation: 'write' as const, handle: 'unopened', position: '0', bytes };
   Object.defineProperty(request, 'extra', { enumerable: true, get: cloneMetadata });
   await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'EINVAL' });
   expect(cloneMetadata).not.toHaveBeenCalled();
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
});

it('bounds canonical file-server reads using the actual retained fragment span', async () => {
 const bytes = Uint8Array.of(0, 255);
 Object.defineProperty(bytes, 'length', { value: 1 });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const identity = {}; let checks = 0;
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, open: async () => ({
  identity, freshness: async () => ({ identity, version: 'v1', async assertCurrent() {
   if (++checks === 3) throw new Error('later freshness failure must not mask invalid canonical read');
  } }),
  stat: async () => ({ type: 'file', size: 2n }), read: async () => bytes, close: async () => {},
 }) });
 try {
  const handle = await server.open(scope, { namespaceId: 'n', path: '/file' }, signal);
  const guard = await server.freshness(scope, handle, signal);
  await expect(server.stream(scope, handle, 0n, 1n, signal, guard).getReader().read()).rejects.toMatchObject({ status: 503 });
 } finally { await server.disposeAll(); }
});

it('bounds live canonical reads and directory carriers before retaining their bytes', async () => {
 const bytes = Uint8Array.of(1, 2);
 Object.defineProperty(bytes, 'length', { value: 1 });
 Object.defineProperty(bytes, 'byteLength', { value: 1 });
 const b = (text: string) => Array.from(new TextEncoder().encode(text));
 const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: b('/work'), originalArgv: [b('native')] };
 const credential = {};
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 3, maxIoBytes: 1,
  fs: { objects: {
   open: async () => ({ identity: {}, type: 'file', stat: async () => ({ type: 'file', size: 2n }), read: async () => bytes, close: async () => {} }),
   readdir: async () => [{ name: new BytePath(bytes), type: 'file' }],
  } } as never,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   let sequence = 0;
   const call = (operation: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId: 'file', stage: 'native-read', ...operation } as JobFileRequest);
   const opened = await call({ operation: 'open', path: b('file') }) as { handle: string };
   await expect(call({ operation: 'read', handle: opened.handle, position: '0', maxBytes: 1 })).rejects.toMatchObject({ code: 'EIO' });
   await expect(call({ operation: 'readdir', path: b('.') })).rejects.toMatchObject({ code: 'EFBIG', syscall: 'readdir' });
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
});

it('refuses an oversized upload descriptor fragment before transmitting any chunk', async () => {
 const bytes = Uint8Array.of(1, 2);
 Object.defineProperty(bytes, 'length', { value: 1 });
 const descriptor = { stat: vi.fn(), read: async () => bytes, close: vi.fn() };
 const declaration = { size: '2', digest: '0'.repeat(64) };
 const uploadChunk = vi.fn(); const abortUpload = vi.fn(async () => {});
 await expect(uploadDescriptor({
  beginUpload: async () => ({ ...declaration, uploadId: 'u', state: 'open', committedOffset: '0' }),
  inspectUpload: vi.fn(), uploadChunk, commitUpload: vi.fn(), abortUpload,
 }, descriptor, declaration, { maxChunkBytes: 1,
  freshness: { descriptor, identity: {}, version: 'v1', profile: 'immutable', assertCurrent: async () => {}, invalidate: vi.fn() },
 })).rejects.toMatchObject({ status: 503 });
 expect(uploadChunk).not.toHaveBeenCalled(); expect(abortUpload).toHaveBeenCalledOnce();
 expect(descriptor.close).not.toHaveBeenCalled();
});
