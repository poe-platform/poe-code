import { expect, it, vi } from 'vitest';
import { createJobBinding } from './job-binding.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['prototype', 'extension'] as const)('observes live retained stat fields without inspecting backend extensions (%s)', async profile => {
 const credential = {};
 let size = 9007199254740993n;
 const observeSize = vi.fn(() => size);
 const extension = vi.fn(() => { throw new Error('private backend state was inspected'); });
 const fields = { type: 'file', get size() { return observeSize(); }, mode: 0o640, atimeNs: 1n, mtimeNs: 2n, ctimeNs: 3n, allocatedBytes: 4096n, nlink: 0n };
 const stat = profile === 'prototype' ? Object.create(fields) : fields;
 Object.defineProperty(stat, 'privateAuthority', { enumerable: true, get: extension });
 const close = vi.fn(async () => {});
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 3,
  fs: { objects: { open: async () => ({ identity: {}, type: 'file', stat: async () => stat, close }) } },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const base = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'file', stage: 'native-fstat' };
   const opened = await input.access(credential, { ...base, callbackId: 'open', operation: 'open', path: bytes('input') }) as { handle: string };
   for (const callbackId of ['first', 'second']) {
    const expectedSize = size;
    expect(await input.access(credential, { ...base, callbackId, operation: 'stat', handle: opened.handle }))
     .toEqual({ type: 'file', size: expectedSize, mode: 0o640, atimeNs: 1n, mtimeNs: 2n, ctimeNs: 3n, allocatedBytes: 4096n, nlink: 0n });
    size++;
   }
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(observeSize).toHaveBeenCalledTimes(2);
 expect(extension).not.toHaveBeenCalled();
 expect(close).toHaveBeenCalledOnce();
});
