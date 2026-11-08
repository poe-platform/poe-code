import { expect, it, vi } from 'vitest';
import { createDescriptorMaterialization } from './descriptors.js';

it('seeks an admitted open description with exact offsets and pins the acquired facet', async () => {
 const seek = vi.fn(async (_offset: bigint) => {});
 const legacy = vi.fn(async (_offset: number) => {});
 const replacement = vi.fn(async () => {});
 const lease = { identity: {}, seek: legacy, exact: { seek }, close: async () => {} };
 const server = createDescriptorMaterialization({ handles: { acquire: async () => lease }, maxHandles: 1, maxIoBytes: 1 });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['seek'], signal);
  lease.exact.seek = replacement;
  await server.seek(opened.handle, '9007199254740993', signal);
  await server.seek(opened.handle, '42', signal);
  expect(seek.mock.calls.map(call => call[0])).toEqual([9007199254740993n, 42n]);
  expect(legacy).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled();
 } finally { await server.dispose(); }
});

it('admits exact-only seek and preserves native failures without a numeric fallback', async () => {
 const failure = Object.assign(new Error('unsupported native offset'), { code: 'EFBIG' });
 const seek = vi.fn(async () => { throw failure; });
 const server = createDescriptorMaterialization({ handles: { acquire: async () => ({ identity: {}, exact: { seek }, close: async () => {} }) }, maxHandles: 1, maxIoBytes: 1 });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['seek'], signal);
  await expect(server.seek(opened.handle, '9007199254740993', signal)).rejects.toBe(failure);
  await expect(server.seek(opened.handle, '9223372036854775808', signal)).rejects.toMatchObject({ code: 'EINVAL' });
  expect(seek).toHaveBeenCalledOnce();
 } finally { await server.dispose(); }
});

it('leaves legacy seek additive and refuses unsafe offsets before calling it', async () => {
 const seek = vi.fn(async (_offset: number) => {});
 const server = createDescriptorMaterialization({ handles: { acquire: async () => ({ identity: {}, seek, close: async () => {} }) }, maxHandles: 1, maxIoBytes: 1 });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['seek'], signal);
  await server.seek(opened.handle, '42', signal);
  await expect(server.seek(opened.handle, '9007199254740993', signal)).rejects.toMatchObject({ code: 'ENOTSUP' });
  expect(seek).toHaveBeenCalledOnce(); expect(seek.mock.calls[0][0]).toBe(42);
 } finally { await server.dispose(); }
});

it('orders exact cursor changes across aliases and passes cancellation to the retained facet', async () => {
 const identity = {}; let cursor = 0n; let release!: () => void; let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const gate = new Promise<void>(resolve => { release = resolve; });
 const read = vi.fn(async () => ({ done: false as const, value: Uint8Array.of(cursor === 9007199254740993n ? 255 : 0) }));
 const exact = { async seek(offset: bigint, options?: { signal?: AbortSignal }) {
  expect(this).toBe(exact); expect(options?.signal?.aborted).toBe(false);
  entered(); await gate; cursor = offset;
 } };
 const server = createDescriptorMaterialization({ handles: { acquire: async () => ({ identity, exact, read, close: async () => {} }) }, maxHandles: 2, maxIoBytes: 1 });
 const signal = new AbortController().signal;
 try {
  const first = await server.acquire(3, ['seek'], signal);
  const alias = await server.acquire(4, ['read'], signal);
  expect(first.object).toBe(alias.object);
  const seeking = server.seek(first.handle, '9007199254740993', signal);
  await started;
  const reading = server.read(alias.handle, 1, signal);
  expect(read).not.toHaveBeenCalled(); release(); await seeking;
  expect(await reading).toEqual({ done: false, value: Uint8Array.of(255) });
 } finally { release?.(); await server.dispose(); }
});

it('does not inspect or admit an exact seek facet without seek rights', async () => {
 const inspect = vi.fn(() => { throw new Error('seek not admitted'); });
 const lease = { identity: {}, close: async () => {} };
 Object.defineProperty(lease, 'exact', { get: inspect });
 const server = createDescriptorMaterialization({ handles: { acquire: async () => lease }, maxHandles: 1, maxIoBytes: 1 });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, [], signal);
  await expect(server.seek(opened.handle, '9007199254740993', signal)).rejects.toMatchObject({ code: 'EBADF' });
  expect(inspect).not.toHaveBeenCalled();
 } finally { await server.dispose(); }
});
