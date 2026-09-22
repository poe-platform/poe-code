import { expect, it, vi } from 'vitest';
import type { BytePath } from '@poe-code/safe-fs/contracts/object';
import { createJobBinding, type JobFileRequest } from './job-binding.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'binding', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };

it.each(['path', 'destination', 'target', 'rights', 'bytes'] as const)(
 'admits indexed callback %s without evaluating private carrier resources', async field => {
  const credential = {};
  const speculative = vi.fn(() => { throw new Error('scratch resource acquired before native access'); });
  const carrier = field === 'rights' ? ['read'] : field === 'bytes' ? [0, 255] : bytes('resource');
  Object.defineProperty(carrier, 'scratch', { enumerable: true, get: speculative });
  const identity = {};
  const close = vi.fn(async () => {});
  const open = vi.fn(async (_path: BytePath) => ({ identity, type: 'file' as const, close, stat: async () => ({ type: 'file' as const, size: 0n }), write: async (_position: bigint, data: Uint8Array) => data.length }));
  const rename = vi.fn(async () => ({ moved: true }));
  const symlink = vi.fn(async () => {});
  const acquire = vi.fn(async () => ({ identity, close, read: async () => ({ done: false as const, value: Uint8Array.of(255) }) }));
  const runtime = createJobBinding({ ...invocation, credential, fs: { objects: { open, rename }, symlink }, handles: { acquire }, maxHandles: 1, maxCallbacks: 2,
   prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
   run: async input => {
    const call = (callbackId: string, operation: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId, fileId: 'resource', stage: 'native-access', ...operation } as JobFileRequest);
    let request: object;
    if (field === 'bytes') {
     const opened = await call('open', { operation: 'open', path: bytes('resource'), access: 'write' }) as { handle: string };
     request = { operation: 'write', handle: opened.handle, position: '0', bytes: carrier };
    } else if (field === 'rights') request = { operation: 'descriptor-acquire', fd: 3, rights: carrier };
    else if (field === 'destination') request = { operation: 'rename', path: bytes('source'), destination: carrier };
    else if (field === 'target') request = { operation: 'symlink', path: bytes('link'), target: carrier };
    else request = { operation: 'open', path: carrier };
    const result = await call('access', request);
    // Replaying the same admitted octets must not reevaluate carrier resources.
    expect(await call('access', request)).toEqual(result);
    expect(speculative).not.toHaveBeenCalled();
    return { exitCode: 1 };
   },
  });
  await expect(runtime.execute(invocation, new AbortController().signal)).resolves.toEqual({ exitCode: 1 });
  if (field === 'path') expect(open.mock.calls[0]?.[0].bytes()).toEqual(new TextEncoder().encode('/work/resource'));
  if (field === 'destination') expect(rename).toHaveBeenCalledOnce();
  if (field === 'target') expect(symlink).toHaveBeenCalledWith('resource', '/work/link', expect.anything());
  if (field === 'rights') expect(acquire).toHaveBeenCalledWith(3, ['read'], expect.any(AbortSignal));
 });
