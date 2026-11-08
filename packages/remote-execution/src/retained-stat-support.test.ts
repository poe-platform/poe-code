import { expect, it, vi } from 'vitest';
import { createJobBinding } from './job-binding.js';
import { createEffectStore } from './effects.js';
import type { JobFileRequest } from './job-binding.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['open', 'create'] as const)('refuses unsupported retained fstat after %s without losing canonical effects', async operation => {
 const credential = {};
 const close = vi.fn(async () => {});
 let content = Uint8Array.of(1, 2, 3);
 const effects = createEffectStore({ maxEffects: 4, maxFrameBytes: 16 });
 const object = { identity: {}, type: 'file' as const, close };
 const runtime = createJobBinding({ ...invocation, credential, effects, maxHandles: 1, maxCallbacks: 2,
  fs: { objects: { open: async () => object, create: async () => {
   content = new Uint8Array();
   return { ...object, creation: 'truncated' as const };
  } } } as never,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const base = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'file' };
   const opened = await input.access(credential, { ...base, stage: 'native-open', callbackId: 'open', operation, path: bytes('output'), access: 'readwrite' }) as { handle: string };
   await expect(input.access(credential, { ...base, stage: 'native-fstat', callbackId: 'stat', operation: 'stat', handle: opened.handle }))
    .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'stat' });
   return { exitCode: 1 };
  },
 });
 await expect(runtime.execute(invocation, new AbortController().signal)).resolves.toEqual({ exitCode: 1 });
 expect(content).toEqual(operation === 'create' ? new Uint8Array() : Uint8Array.of(1, 2, 3));
 expect(effects.inspect().effects).toEqual([expect.objectContaining({ operation: operation === 'create' ? 'truncate' : 'open', stage: 'native-open' })]);
 expect(close).toHaveBeenCalledOnce();
});

it.each(['read', 'write', 'truncate'] as const)('reports unsupported canonical %s at its native operation', async operation => {
 const credential = {};
 const close = vi.fn(async () => {});
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 2,
  fs: { objects: { open: async () => ({ identity: {}, type: 'file' as const, stat: async () => ({ type: 'file' as const, size: 0n }), close }) } },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const base = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'file' };
   const opened = await input.access(credential, { ...base, stage: 'native-open', callbackId: 'open', operation: 'open', path: bytes('output'), access: 'readwrite' }) as { handle: string };
   const request = { ...base, stage: `native-${operation}`, callbackId: 'operation', operation, handle: opened.handle, position: '0', maxBytes: 1, bytes: Uint8Array.of(255), length: '0' } as JobFileRequest;
   await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'ENOTSUP', syscall: operation });
   return { exitCode: 1 };
  },
 });
 await expect(runtime.execute(invocation, new AbortController().signal)).resolves.toEqual({ exitCode: 1 });
 expect(close).toHaveBeenCalledOnce();
});
