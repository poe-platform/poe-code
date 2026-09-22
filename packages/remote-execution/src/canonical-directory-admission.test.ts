import { BytePath } from '@poe-code/safe-fs/contracts/object';
import { expect, it, vi } from 'vitest';
import { admitFileListing } from './files.js';
import { createJobBinding } from './job-binding.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['grow', 'shrink'] as const)('refuses a text directory listing that changes length during admission (%s)', change => {
 const entries = [{ name: 'first', type: 'file' as const }];
 Object.defineProperty(entries[0], 'name', { get() {
  if (change === 'grow') entries.push({ name: 'late', type: 'file' });
  else entries.length = 0;
  return 'first';
 } });
 expect(() => admitFileListing(entries, 1, 1024)).toThrow(expect.objectContaining({ code: 'EIO' }));
});

it.each(['grow', 'shrink'] as const)('refuses a byte directory listing that changes length during admission and retains its error receipt (%s)', async change => {
 const credential = {};
 const name = new BytePath(Uint8Array.of(255));
 const entries = [{ name, type: 'file' as const }];
 Object.defineProperty(entries[0], 'name', { get() {
  if (change === 'grow') entries.push({ name, type: 'file' });
  else entries.length = 0;
  return name;
 } });
 const readdir = vi.fn(async () => entries);
 const binding = createJobBinding({ ...invocation, credential, maxHandles: 1, maxCallbacks: 1, maxDirectoryEntries: 1,
  fs: { objects: { open: vi.fn(), readdir } },
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'list', fileId: 'directory', stage: 'native-readdir', operation: 'readdir' as const, path: bytes('.') };
   await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'EIO', syscall: 'readdir' });
   await expect(input.access(credential, request)).rejects.toMatchObject({ code: 'EIO', syscall: 'readdir' });
   return { exitCode: 1 };
  },
 });
 expect(await binding.execute(invocation, new AbortController().signal)).toEqual({ exitCode: 1 });
 expect(readdir).toHaveBeenCalledOnce();
 expect(readdir).toHaveBeenCalledWith(expect.any(BytePath), { signal: expect.any(AbortSignal), maxEntries: 1 });
});
