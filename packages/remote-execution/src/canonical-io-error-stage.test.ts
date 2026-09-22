import { expect, it, vi } from 'vitest';
import { createJobBinding, type JobFileRequest } from './job-binding.js';
import { createDescriptorMaterialization } from './descriptors.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['read', 'write', 'append'] as const)('reports malformed canonical %s receipts at that operation without undoing storage', async operation => {
 const credential = {};
 const close = vi.fn(async () => {});
 let content = Uint8Array.of(1);
 const mutate = vi.fn(async () => { content = Uint8Array.of(255); return 2; });
 const binding = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 3, maxIoBytes: 1,
  fs: { objects: { open: async () => ({ identity: {}, type: 'file',
   stat: async () => ({ type: 'file', size: BigInt(content.length) }),
   read: async () => Uint8Array.of(1, 2), write: mutate, append: mutate, close,
  }) } },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const base = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'file' };
   const opened = await input.access(credential, { ...base, callbackId: 'open', stage: 'native-open', operation: 'open', path: bytes('file'), access: 'readwrite' }) as { handle: string };
   const request = { ...base, callbackId: 'io', stage: `native-${operation}`, operation, handle: opened.handle, position: '0', maxBytes: 1, bytes: Uint8Array.of(255) } as JobFileRequest;
   await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'EIO', syscall: operation });
   // Recovery reports the same failure and never repeats a canonical mutation.
   await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'EIO', syscall: operation });
   return { exitCode: 1 };
  },
 });
 expect(await binding.execute(invocation, new AbortController().signal)).toEqual({ exitCode: 1 });
 expect(content).toEqual(Uint8Array.of(operation === 'read' ? 1 : 255));
 expect(mutate).toHaveBeenCalledTimes(operation === 'read' ? 0 : 1);
 expect(close).toHaveBeenCalledOnce();
});

it.each(['read', 'write'] as const)('reports malformed retained descriptor %s receipts at the original syscall', async operation => {
 const signal = new AbortController().signal;
 const close = vi.fn(async () => {});
 const descriptors = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1,
  handles: { acquire: async () => ({ identity: {}, close,
   read: async () => ({ done: false, value: undefined as never }),
   write: async () => 2,
  }) },
 });
 try {
  const opened = await descriptors.acquire(3, [operation], signal);
  const result = operation === 'read' ? descriptors.read(opened.handle, 1, signal)
   : descriptors.write(opened.handle, Uint8Array.of(255), signal);
  await expect(result).rejects.toMatchObject({ code: 'EIO', syscall: operation });
 } finally { await descriptors.dispose(); }
 expect(close).toHaveBeenCalledOnce();
});
