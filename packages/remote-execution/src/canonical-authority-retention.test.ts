import { expect, it, vi } from 'vitest';
import { createJobBinding, type JobFileRequest } from './job-binding.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['create', 'rename', 'unlink', 'readdir', 'path-access', 'realpath', 'path-stat', 'path-lstat', 'readlink', 'symlink', 'mkdir', 'rmdir', 'capabilities', 'descriptor-acquire'] as const)(
 'retains canonical %s authority when issued without freezing live observations', async operation => {
  const credential = {};
  let live = 1;
  const close = vi.fn(async () => {});
  const identity = {};
  const object = { identity, type: 'file' as const, creation: 'created' as const, stat: async () => ({ type: 'file' as const, size: BigInt(live) }), close };
  const metadata = () => ({ type: 'file', size: live, mode: 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 });
  const canonical = vi.fn(async () => {
   if (operation === 'create') return object;
   if (operation === 'readdir') return [];
   if (operation === 'realpath') return `/live/${live}`;
   if (operation === 'readlink') return `target-${live}`;
   if (operation === 'path-stat' || operation === 'path-lstat') return metadata();
   if (operation === 'capabilities') return { readOnly: live === 2 };
   if (operation === 'descriptor-acquire') return { identity, close };
  });
  const methods: Record<string, string> = { 'path-access': 'access', 'path-stat': 'stat', 'path-lstat': 'lstat', capabilities: 'capabilitiesFor', 'descriptor-acquire': 'acquire' };
  const method = methods[operation] ?? operation;
  const objects = { open: vi.fn(), ...(['create', 'rename', 'unlink', 'readdir'].includes(operation) ? { [method]: canonical } : {}) };
  const fs = { objects, ...(!['create', 'rename', 'unlink', 'readdir', 'descriptor-acquire'].includes(operation) ? { [method]: canonical } : {}) };
  const handles = { acquire: canonical };
  const scratch = vi.fn(async () => { throw new Error('scratch authority substituted'); });
  const runtime = createJobBinding({ ...invocation, credential, fs: fs as never, handles: handles as never, maxHandles: 1, maxCallbacks: 1,
   prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
   run: async input => {
    const result = await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'access', fileId: 'resource', stage: 'native-access', operation, path: bytes('resource'), destination: bytes('destination'), target: bytes('target'), flag: 'w', fd: 3, rights: [] } as JobFileRequest);
    if (operation === 'realpath') expect(result).toEqual(bytes('/live/2'));
    if (operation === 'readlink') expect(result).toEqual(bytes('target-2'));
    if (operation === 'path-stat' || operation === 'path-lstat') expect(result).toMatchObject({ size: 2 });
    if (operation === 'capabilities') expect(result).toEqual({ readOnly: true });
    return { exitCode: 1 };
   },
  });
  const owner = ['create', 'rename', 'unlink', 'readdir'].includes(operation) ? objects : operation === 'descriptor-acquire' ? handles : fs;
  Object.assign(owner, { [method]: scratch });
  live = 2;
  await runtime.execute(invocation, new AbortController().signal);
  expect(canonical).toHaveBeenCalledOnce();
  expect(canonical.mock.contexts[0]).toBe(owner);
  expect(scratch).not.toHaveBeenCalled();
  if (operation === 'create' || operation === 'descriptor-acquire') expect(close).toHaveBeenCalledOnce();
 });

it.each(['create', 'readdir', 'readlink'] as const)('does not upgrade unavailable %s authority after issuance', async operation => {
 const credential = {};
 const fs = { objects: { open: vi.fn() } };
 const added = vi.fn(async () => { throw new Error('unadmitted authority'); });
 const runtime = createJobBinding({ ...invocation, credential, fs, maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'access', fileId: 'resource', stage: 'native-access', operation, path: bytes('resource'), fd: 3, rights: [] } as JobFileRequest)).rejects.toMatchObject({ code: 'ENOTSUP' });
   return { exitCode: 1 };
  },
 });
 Object.assign(operation === 'create' || operation === 'readdir' ? fs.objects : fs, { [operation]: added });
 await runtime.execute(invocation, new AbortController().signal);
 expect(added).not.toHaveBeenCalled();
});

it('keeps unknown and false read-only capabilities unchanged without probing an object', async () => {
 const credential = {};
 const advertised = { readOnly: true, write: undefined, append: false, read: true, readdir: undefined, retainedRead: true };
 const open = vi.fn();
 const runtime = createJobBinding({ ...invocation, credential, fs: { objects: { open }, capabilitiesFor: async () => advertised } as never,
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   expect(await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'mount', stage: 'native-policy', operation: 'capabilities', path: bytes('readonly') })).toEqual(advertised);
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(open).not.toHaveBeenCalled();
});

it('makes per-path read-only policy take precedence over mutation claims', async () => {
 const credential = {};
 const advertised = { readOnly: true, read: true, write: true, append: true, truncate: true, streamingWrite: true, streamingAppend: true, descriptorWriteStream: true, randomAccessWrite: true, exclusiveCreate: true, mkdir: true, recursiveMkdir: true, remove: true, removeDirectory: true, recursiveRemove: true, rename: true, copy: true, exclusiveCopy: true, symlinks: true, hardlinks: true, permissions: true, timestamps: true, atomicRename: true, atomicRenameNoReplace: true, atomicFileStaging: true, atomicFileMutation: true, atomicDirectoryMetadata: true, atomicResize: true, retainedResize: true };
 const operation = vi.fn();
 const runtime = createJobBinding({ ...invocation, credential,
  fs: { objects: { open: operation, create: operation, rename: operation, unlink: operation }, capabilitiesFor: async () => advertised, mkdir: operation, rmdir: operation, symlink: operation } as never,
  maxHandles: 1, maxCallbacks: 1,
  prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
  run: async input => {
   const result = await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'policy', fileId: 'mount', stage: 'native-policy', operation: 'capabilities', path: bytes('readonly/out'), create: true });
   expect(result).toEqual(Object.fromEntries(Object.keys(advertised).map(key => [key, key === 'readOnly' || key === 'read'])));
   return { exitCode: 0 };
  },
 });
 await runtime.execute(invocation, new AbortController().signal);
 expect(advertised.write).toBe(true);
 expect(operation).not.toHaveBeenCalled();
});
