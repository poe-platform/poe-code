import { expect, it, vi } from 'vitest';
import { createJobBinding, type JobFileRequest } from './job-binding.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [bytes('native')] };

it('checks permissions and resolves symlinks at each canonical access, preserving backend errors', async () => {
 const credential = {}; let current = '/shared/first';
 const denied = Object.assign(new Error('read-only mount'), { code: 'EROFS', syscall: 'access' });
 const access = vi.fn(async (_path: string, mode: number) => { if (mode === 2) throw denied; });
 const realpath = vi.fn(async () => current);
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: vi.fn() }, access, realpath } as never,
  maxHandles: 1, maxCallbacks: 6,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   expect(access).not.toHaveBeenCalled(); expect(realpath).not.toHaveBeenCalled();
   let sequence = 0;
   const call = (operation: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId: 'link', stage: 'native-permission', ...operation } as JobFileRequest);
   await expect(call({ operation: 'path-access', path: bytes('link'), mode: 4 })).resolves.toBeUndefined();
   await expect(call({ operation: 'path-access', path: bytes('link'), mode: 2 })).rejects.toBe(denied);
   expect(await call({ operation: 'realpath', path: bytes('link') })).toEqual(bytes(current));
   current = '/shared/\ufefflive/playlist';
   expect(await call({ operation: 'realpath', path: bytes('link') })).toEqual(bytes(current));
   await expect(call({ operation: 'path-access', path: bytes('link'), mode: 8 })).rejects.toMatchObject({ code: 'EINVAL', syscall: 'access' });
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(access).toHaveBeenCalledTimes(2);
 expect(access).toHaveBeenCalledWith('/work/link', 4, { signal: expect.any(AbortSignal) });
 expect(realpath).toHaveBeenCalledTimes(2);
});

it.each([['relative', 'EIO'], ['', 'EIO'], ['/bad\0path', 'EIO'], ['/bad\ud800', 'EILSEQ'], ['/long/path', 'EFBIG']] as const)('refuses invalid canonical realpath %j without substituting bytes', async (resolved, code) => {
 const credential = {};
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: vi.fn() }, realpath: async () => resolved } as never,
  maxHandles: 1, maxCallbacks: 1, maxIoBytes: 9,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'resolve', fileId: 'link', stage: 'native-realpath', operation: 'realpath', path: bytes('link') })).rejects.toMatchObject({ code, syscall: 'realpath' });
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
});

it.each(['path-access', 'realpath'] as const)('refuses unavailable %s rather than consulting scratch files', async operation => {
 const credential = {}; const open = vi.fn();
 const runtime = createJobBinding({ ...invocation, credential, fs: { objects: { open } },
  maxHandles: 1, maxCallbacks: 2,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'link', stage: 'native-access', operation };
   const syscall = operation === 'path-access' ? 'access' : 'realpath';
   await expect(input.access(credential, { ...request, callbackId: 'missing', path: bytes('link') })).rejects.toMatchObject({ code: 'ENOTSUP', syscall });
   await expect(input.access(credential, { ...request, callbackId: 'non-utf8', path: [255] })).rejects.toMatchObject({ code: 'EILSEQ', syscall });
   return { exitCode: 1 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(open).not.toHaveBeenCalled();
});
