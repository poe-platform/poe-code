import { BytePath } from '@poe-code/safe-fs/contracts/object';
import { expect, it, vi } from 'vitest';
import { createJobBinding } from './job-binding.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['override', 'forged'] as const)('keeps canonical directory names bound to their owned BytePath carrier (%s)', async profile => {
 const credential = {};
 const replacement = vi.fn(() => Uint8Array.of(120));
 const name = profile === 'override' ? new BytePath(Uint8Array.of(255, 128)) : {};
 Object.defineProperty(name, 'bytes', { get: () => replacement });
 const runtime = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 1,
  fs: { objects: { open: vi.fn(), readdir: async () => [{ name, type: 'file' }] } } as never,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const listing = input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'list', fileId: 'directory', stage: 'native-readdir', operation: 'readdir', path: bytes('.') });
   if (profile === 'override') expect(await listing).toEqual([{ name: [255, 128], type: 'file' }]);
   else await expect(listing).rejects.toMatchObject({ code: 'EIO', syscall: 'readdir' });
   expect(replacement).not.toHaveBeenCalled();
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
});
