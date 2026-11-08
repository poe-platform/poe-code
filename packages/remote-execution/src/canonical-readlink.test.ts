import { expect, it, vi } from 'vitest';
import { createJobBinding } from './job-binding.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const invocation = {
  sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant',
  materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd',
  cwd: bytes('/work'), originalArgv: [bytes('link')],
};

it.each([
  ['unpaired surrogate', '\ud800', 'EILSEQ'],
  ['embedded NUL', 'a\0b', 'EIO'],
  ['empty target', '', 'EIO'],
  ['non-string target', undefined, 'EIO'],
] as const)('refuses a canonical readlink %s without manufacturing target bytes', async (_name, target, code) => {
  const credential = {};
  const readlink = vi.fn(async () => target as string);
  const runtime = createJobBinding({
    ...invocation, credential, fs: { objects: { open: vi.fn() }, readlink },
    maxHandles: 1, maxCallbacks: 2,
    prepare: async () => ({ ...invocation, state: 'ready', entries: [],
      readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
    run: async input => {
      await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
        callbackId: 'readlink', fileId: 'link', stage: 'native-readlink', operation: 'readlink', path: bytes('link') }))
        .rejects.toMatchObject({ code, syscall: 'readlink' });
      return { exitCode: 1 };
    },
  });
  await runtime.execute(invocation, new AbortController().signal);
  expect(readlink).toHaveBeenCalledOnce();
});

it('preserves BOM, relative spelling and Unicode in a live canonical link target', async () => {
  const credential = {}; let target = '\ufeff../first/😀';
  const runtime = createJobBinding({
    ...invocation, credential, fs: { objects: { open: vi.fn() }, readlink: async () => target },
    maxHandles: 1, maxCallbacks: 2,
    prepare: async () => ({ ...invocation, state: 'ready', entries: [],
      readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
    run: async input => {
      for (const callbackId of ['first', 'second']) {
        expect(await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
          callbackId, fileId: 'link', stage: 'native-readlink', operation: 'readlink', path: bytes('link') }))
          .toEqual(bytes(target));
        target = '\ufeff../../live/playlist';
      }
      return { exitCode: 0 };
    },
  });
  await runtime.execute(invocation, new AbortController().signal);
});
