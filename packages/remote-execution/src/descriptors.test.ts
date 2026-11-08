import { expect, it, vi } from 'vitest';
import { createDescriptorMaterialization } from './descriptors.js';
it.each(['caller', 'disposal'] as const)('drains an admitted close despite %s cancellation while a canonical write is pending', async cancellationSource => {
 const signal = new AbortController().signal;
 const cancellation = new AbortController();
 let entered!: () => void; let release!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const blocked = new Promise<void>(resolve => { release = resolve; });
 const close = vi.fn(async () => {});
 const content: number[] = [];
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 2, handles: {
  acquire: async () => ({ identity: {}, close, write: async bytes => {
   entered(); await blocked; content.push(bytes[0]); return 1;
  } }),
 } });
 const opened = await server.acquire(3, ['write'], signal);
 const writing = server.write(opened.handle, Uint8Array.of(255, 0), signal);
 await started;
 const closing = server.close(opened.handle, cancellation.signal);
 const completed = expect(closing).resolves.toBeUndefined();
 const disposal = cancellationSource === 'disposal' ? server.dispose() : undefined;
 if (cancellationSource === 'caller') cancellation.abort(new Error('caller disconnected'));
 expect(close).not.toHaveBeenCalled();
 release();
 expect(await writing).toBe(1);
 await completed;
 expect(content).toEqual([255]);
 expect(close).toHaveBeenCalledOnce();
 if (disposal) {
  await disposal;
  expect(close).toHaveBeenCalledOnce();
 } else {
  // Retirement releases capacity without requiring whole-job disposal.
  await server.acquire(4, [], signal);
  await server.dispose();
  expect(close).toHaveBeenCalledTimes(2);
 }
});
it('rejects a cancelled close before consuming the borrowed handle', async () => {
 const signal = new AbortController().signal;
 const close = vi.fn(async () => {});
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1,
  handles: { acquire: async () => ({ identity: {}, close, write: async () => 1 }) },
 });
 const opened = await server.acquire(3, ['write'], signal);
 const cause = new Error('cancelled before close admission');
 await expect(server.close(opened.handle, AbortSignal.abort(cause))).rejects.toBe(cause);
 expect(await server.write(opened.handle, Uint8Array.of(255), signal)).toBe(1);
 expect(close).not.toHaveBeenCalled();
 await server.close(opened.handle, signal);
 await server.dispose();
 expect(close).toHaveBeenCalledOnce();
});
it('refuses writes to a closed descriptor destination without retiring sibling descriptors', async () => {
 const consumer = new AbortController();
 const cause = Object.assign(new Error('destination closed'), { code: 'EPIPE', syscall: 'write' });
 const write = vi.fn(async () => 1);
 const siblingWrite = vi.fn(async () => 1);
 const signal = new AbortController().signal;
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1, handles: {
  acquire: async fd => ({ identity: {}, close: async () => {}, write: fd === 3 ? write : siblingWrite,
   ...(fd === 3 ? { consumerClosed: consumer.signal } : {}) }),
 } });
 try {
  const first = await server.acquire(3, ['write'], signal);
  const sibling = await server.acquire(4, ['write'], signal);
  consumer.abort(cause);
  await expect(server.write(first.handle, Uint8Array.of(1), signal)).rejects.toBe(cause);
  expect(write).not.toHaveBeenCalled();
  expect(await server.write(sibling.handle, Uint8Array.of(2), signal)).toBe(1);
 } finally { await server.dispose(); }
});

it('propagates destination closure into cooperative descriptor writes and preserves settled progress', async () => {
 const consumer = new AbortController();
 const cause = Object.assign(new Error('destination closed'), { code: 'EPIPE', syscall: 'write' });
 let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 let release!: () => void;
 let visible = 0;
 let calls = 0;
 const write = vi.fn(async (_bytes: Uint8Array, signal: AbortSignal) => {
  if (++calls === 1) { visible++; return 1; }
  entered();
  return new Promise<number>((resolve, reject) => {
   release = () => resolve(1);
   signal.addEventListener('abort', () => reject(signal.reason), { once: true });
   if (signal.aborted) reject(signal.reason);
  });
 });
 const signal = new AbortController().signal;
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity: {}, write, consumerClosed: consumer.signal, close: async () => {} }),
 } });
 try {
  const first = await server.acquire(3, ['write'], signal);
  expect(await server.write(first.handle, Uint8Array.of(1), signal)).toBe(1);
  const pending = server.write(first.handle, Uint8Array.of(2), signal).then(value => ({ value }), error => ({ error }));
  await started;
  consumer.abort(cause);
  await new Promise<void>(resolve => { setImmediate(resolve); });
  const observed = write.mock.calls[1][1].aborted;
  release();
  expect(await pending).toEqual({ error: cause });
  expect(observed).toBe(true);
  expect(visible).toBe(1);
 } finally { await server.dispose(); }
});

it('acknowledges a completed canonical descriptor write when its destination closes before settlement', async () => {
 const consumer = new AbortController();
 const cause = new Error('destination closed');
 let visible = 0;
 const signal = new AbortController().signal;
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 2, handles: {
  acquire: async () => ({ identity: {}, consumerClosed: consumer.signal, close: async () => {},
   write: async () => { visible = 1; consumer.abort(cause); return 1; } }),
 } });
 try {
  const first = await server.acquire(3, ['write'], signal);
  expect(await server.write(first.handle, Uint8Array.of(1, 2), signal)).toBe(1);
  expect(visible).toBe(1);
  await expect(server.write(first.handle, Uint8Array.of(2), signal)).rejects.toBe(cause);
 } finally { await server.dispose(); }
});

it('queues close before read cancellation can admit new alias work', async () => {
 const identity = {}; let aliasHandle = ''; let aliasRead: Promise<unknown> | undefined;
 let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
 let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
 const close = vi.fn(async () => {}); let acquisitions = 0;
 const signal = new AbortController().signal;
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity, close, read: ++acquisitions === 1
   ? async (_count, readSignal) => { entered(); return new Promise((_, reject) => {
    readSignal.addEventListener('abort', () => {
     aliasRead = server.read(aliasHandle, 1, signal);
     reject(readSignal.reason);
    }, { once: true });
   }); }
   : async () => { await gate; return { done: true as const, value: undefined }; },
  }),
 } });
 const first = await server.acquire(3, ['read'], signal);
 aliasHandle = (await server.acquire(4, ['read'], signal)).handle;
 const pending = server.read(first.handle, 1, signal).catch(cause => cause);
 await started;
 const closing = server.close(first.handle, signal);
 const observation = await Promise.race([closing.then(() => true), new Promise<false>(resolve => { setImmediate(() => resolve(false)); })]);
 release();
 try {
  await pending; await closing; await aliasRead;
  expect(observation).toBe(true); expect(close).toHaveBeenCalledOnce();
 } finally { await server.dispose(); }
});
it('bounds queued descriptor writes while preserving independent credit and close capacity', async () => {
 let release!: () => void; let entered!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const started = new Promise<void>(resolve => { entered = resolve; });
 const write = vi.fn(async () => { entered(); await gate; return 1; });
 const close = vi.fn(async () => {});
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1,
  handles: { acquire: async () => ({ identity: {}, write, close }) },
 });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, ['write'], signal);
 const sibling = await server.acquire(4, ['write'], signal);
 const queued = Array.from({ length: 16 }, () => server.write(first.handle, Uint8Array.of(7), signal));
 await started;
 const extra = server.write(first.handle, Uint8Array.of(8), signal).then(value => ({ value }), cause => ({ cause }));
 const observation = await Promise.race([extra, new Promise<undefined>(resolve => { setImmediate(() => resolve(undefined)); })]);
 const independent = server.write(sibling.handle, Uint8Array.of(9), signal);
 const closing = server.close(first.handle, signal);
 release();
 try {
  await Promise.all(queued); await extra; expect(await independent).toBe(1); await closing;
  expect(observation).toMatchObject({ cause: { code: 'EAGAIN' } });
  expect(write).toHaveBeenCalledTimes(17);
 } finally { await server.dispose(); }
 expect(close).toHaveBeenCalledTimes(2);
});
it('retires a cooperative idle descriptor read on close without canceling a duplicate', async () => {
 let reading!: () => void; const started = new Promise<void>(resolve => { reading = resolve; });
 const identity = {}; let acquisitions = 0; const close = vi.fn(async () => {});
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity, close, read: ++acquisitions === 1
   ? async (_count, signal) => { reading(); return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    if (signal.aborted) reject(signal.reason);
   }); }
   : async () => ({ done: false as const, value: Uint8Array.of(9) }),
  }),
 } });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, ['read'], signal);
 const alias = await server.acquire(4, ['read'], signal);
 const pending = server.read(first.handle, 1, signal).then(value => ({ value }), cause => ({ cause }));
 await started;
 const closing = server.close(first.handle, signal);
 const closed = closing.then(() => true, () => false);
 const observation = await Promise.race([closed, new Promise<false>(resolve => { setImmediate(() => resolve(false)); })]);
 // Disposal cooperatively cancels the fixture even if close failed to retire it.
 if (!observation) await server.dispose();
 try {
  expect(observation).toBe(true);
  expect(await pending).toMatchObject({ cause: { code: 'EBADF' } });
  await closing;
  expect(await server.read(alias.handle, 1, signal)).toEqual({ done: false, value: Uint8Array.of(9) });
 } finally { await server.dispose(); }
 expect(close).toHaveBeenCalledTimes(2);
});
it('bounds descriptor rights before inspecting slots or acquiring a lease', async () => {
 const acquire = vi.fn(); const inspect = vi.fn(() => 'read');
 const rights = Array(5);
 Object.defineProperty(rights, 0, { get: inspect });
 const server = createDescriptorMaterialization({ handles: { acquire }, maxHandles: 1, maxIoBytes: 1 });
 try {
  await expect(server.acquire(3, rights, new AbortController().signal)).rejects.toMatchObject({ code: 'EINVAL' });
  expect(inspect).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled();
 } finally { await server.dispose(); }
});
it('closes descriptor admission before draining accepted cursor work and leaves aliases usable', async () => {
 const identity = {}; let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let reading!: () => void; const started = new Promise<void>(resolve => { reading = resolve; });
 const read = vi.fn(async () => { reading(); await gate; return { done: false as const, value: Uint8Array.of(7) }; });
 const close = vi.fn(async () => {});
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1,
  handles: { acquire: async () => ({ identity, read, close }) },
 });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, ['read'], signal);
 const alias = await server.acquire(4, ['read'], signal);
 const accepted = server.read(first.handle, 1, signal);
 await started;
 const closing = server.close(first.handle, signal);
 const late = server.read(first.handle, 1, signal).then(value => ({ value }), cause => ({ cause }));
 const repeated = server.close(first.handle, signal).then(value => ({ value }), cause => ({ cause }));
 const turn = () => new Promise<undefined>(resolve => { setImmediate(() => resolve(undefined)); });
 const lateObservation = await Promise.race([late, turn()]);
 const repeatedObservation = await Promise.race([repeated, turn()]);
 expect(close).not.toHaveBeenCalled();
 release();
 try {
  expect(await accepted).toEqual({ done: false, value: Uint8Array.of(7) });
  await closing; await late; await repeated;
  expect(lateObservation).toMatchObject({ cause: { code: 'EBADF' } });
  expect(repeatedObservation).toMatchObject({ cause: { code: 'EBADF' } });
  expect(await server.read(alias.handle, 1, signal)).toEqual({ done: false, value: Uint8Array.of(7) });
  expect(read).toHaveBeenCalledTimes(2);
 } finally { await server.dispose(); }
 expect(close).toHaveBeenCalledTimes(2);
});
it('measures actual descriptor read and write spans before copying shadowed carriers', async () => {
 const oversized = Uint8Array.of(1, 2, 3);
 Object.defineProperty(oversized, 'length', { value: 1 });
 Object.defineProperty(oversized, 'byteLength', { value: 1 });
 const write = vi.fn(async (bytes: Uint8Array) => bytes.length);
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity: {}, read: async () => ({ done: false as const, value: oversized }), write, close: async () => {} }),
 } });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['read', 'write'], signal);
  await expect(server.read(opened.handle, 1, signal)).rejects.toMatchObject({ code: 'EIO' });
  await expect(server.write(opened.handle, oversized, signal)).rejects.toMatchObject({ code: 'EINVAL' });
  expect(write).not.toHaveBeenCalled();
 } finally { await server.dispose(); }
});
it('acquires indexed descriptor rights without allowing an iterator to substitute write access', async () => {
 const acquire = vi.fn(async () => ({ identity: {}, read: async () => ({ done: true as const, value: undefined }), close: async () => {} }));
 const rights: Array<'read' | 'write'> = ['read'];
 rights[Symbol.iterator] = function* () { yield 'write'; };
 const server = createDescriptorMaterialization({ handles: { acquire }, maxHandles: 1, maxIoBytes: 1 });
 try {
  await expect(server.acquire(3, rights, new AbortController().signal)).resolves.toHaveProperty('handle');
  expect(acquire).toHaveBeenCalledWith(3, ['read'], expect.any(AbortSignal));
 } finally { await server.dispose(); }
});
it('refuses inherited descriptor rights before canonical acquisition', async () => {
 const acquire = vi.fn();
 const rights = Array(1);
 Object.setPrototypeOf(rights, Object.assign(Object.create(Array.prototype), { 0: 'write' }));
 const server = createDescriptorMaterialization({ handles: { acquire }, maxHandles: 1, maxIoBytes: 1 });
 try {
  await expect(server.acquire(3, rights, new AbortController().signal)).rejects.toMatchObject({ code: 'EINVAL' });
  expect(acquire).not.toHaveBeenCalled();
 } finally { await server.dispose(); }
});
it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])('refuses an unrepresentable retained cursor %s and releases its lease', async position => {
 const close = vi.fn(async () => {});
 const server = createDescriptorMaterialization({ handles: { acquire: async () => ({ identity: {}, position, close }) }, maxHandles: 1, maxIoBytes: 1 });
 try {
  await expect(server.acquire(3, [], new AbortController().signal)).rejects.toMatchObject({ code: 'ENOTSUP' });
  expect(close).toHaveBeenCalledOnce();
 } finally { await server.dispose(); }
});
it('preserves short and zero-byte descriptor reads, explicit EOF and upstream failures', async () => {
 const fragment = Buffer.from([0, 255]);
 const failure = Object.assign(new Error('canonical read denied'), { code: 'EACCES' });
 const read = vi.fn()
  .mockResolvedValueOnce({ value: fragment })
  .mockResolvedValueOnce({ done: false, value: new Uint8Array() })
  .mockResolvedValueOnce({ done: true, get value() { throw new Error('EOF has no fragment'); } })
  .mockRejectedValueOnce(failure);
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 8, handles: {
  acquire: async () => ({ identity: {}, read, close: async () => {} }),
 } });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['read'], signal);
  const short = await server.read(opened.handle, 8, signal);
  fragment.fill(9);
  expect(short).toEqual({ done: false, value: Uint8Array.of(0, 255) });
  expect(await server.read(opened.handle, 0, signal)).toEqual({ done: false, value: new Uint8Array() });
  expect(await server.read(opened.handle, 8, signal)).toEqual({ done: true, value: undefined });
  await expect(server.read(opened.handle, 8, signal)).rejects.toBe(failure);
 } finally { await server.dispose(); }
});
it('refuses an empty positive descriptor read without inventing EOF or advancing an alias', async () => {
 const read = vi.fn()
  .mockResolvedValueOnce({ done: false, value: new Uint8Array() })
  .mockResolvedValueOnce({ done: false, value: Uint8Array.of(255) });
 const identity = {};
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 8, handles: {
  acquire: async () => ({ identity, read, close: async () => {} }),
 } });
 const signal = new AbortController().signal;
 try {
  const first = await server.acquire(3, ['read'], signal);
  const alias = await server.acquire(4, ['read'], signal);
  await expect(server.read(first.handle, 8, signal)).rejects.toMatchObject({ code: 'EIO', syscall: 'read' });
  expect(await server.read(alias.handle, 8, signal)).toEqual({ done: false, value: Uint8Array.of(255) });
  expect(read).toHaveBeenCalledTimes(2);
 } finally { await server.dispose(); }
});
it('transfers the same bounded descriptor fragment that it validated', async () => {
 let observations = 0;
 const fragment = Uint8Array.of(0, 255);
 const result = { done: false as const, get value() {
  return ++observations === 1 ? fragment : Uint8Array.of(9, 9, 9);
 } };
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 2, handles: {
  acquire: async () => ({ identity: {}, read: async () => result, close: async () => {} }),
 } });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['read'], signal);
  expect(await server.read(opened.handle, 2, signal)).toEqual({ done: false, value: fragment });
  expect(observations).toBe(1);
 } finally { await server.dispose(); }
});
it.each([null, undefined, { done: 'yes' }, { done: 1 }, { done: false, value: Uint8Array.of(1, 2, 3) }])(
 'refuses malformed descriptor read completion %j without reporting EOF', async result => {
  const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 2, handles: {
   acquire: async () => ({ identity: {}, read: async () => result as never, close: async () => {} }),
  } });
  const signal = new AbortController().signal;
  try {
   const opened = await server.acquire(3, ['read'], signal);
   await expect(server.read(opened.handle, 2, signal)).rejects.toMatchObject({ code: 'EIO' });
  } finally { await server.dispose(); }
 });
it('does not inspect operations outside the admitted descriptor rights', async () => {
 const read = vi.fn(async () => ({ done: false as const, value: Uint8Array.of(7) }));
 const close = vi.fn(async () => {});
 const lease = { identity: {}, read, close };
 const write = vi.fn(() => { throw new Error('write not admitted'); });
 Object.defineProperty(lease, 'write', { get: write });
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: { acquire: async () => lease } });
 const signal = new AbortController().signal;
 try {
  const file = await server.acquire(3, ['read'], signal);
  expect(await server.read(file.handle, 1, signal)).toEqual({ done: false, value: Uint8Array.of(7) });
  await expect(server.write(file.handle, Uint8Array.of(8), signal)).rejects.toMatchObject({ code: 'EBADF' });
 } finally { await server.dispose(); }
 expect(write).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
it('retires the borrowed lease with its acquired close when identity admission fails', async () => {
 const failure = new Error('identity unavailable');
 const close = vi.fn(async () => {}); const replacement = vi.fn(async () => {});
 const lease = { identity: {}, close };
 Object.defineProperty(lease, 'identity', { get() { lease.close = replacement; throw failure; } });
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: { acquire: async () => lease } });
 try { await expect(server.acquire(3, [], new AbortController().signal)).rejects.toBe(failure); }
 finally { await server.dispose(); }
 expect(close).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
});
it('validates captured descriptor rights before asking the caller for a lease', async () => {
 let observations = 0;
 const rights = ['read'];
 Object.defineProperty(rights, 0, { enumerable: true, get() { return ++observations === 1 ? 'read' : 'execute'; } });
 const acquire = vi.fn(async () => ({ identity: {}, read: async () => ({ done: true as const, value: undefined }), close: async () => {} }));
 const server = createDescriptorMaterialization({ handles: { acquire }, maxHandles: 1, maxIoBytes: 1 });
 try {
  await expect(server.acquire(3, rights as never, new AbortController().signal)).resolves.toHaveProperty('handle');
  expect(acquire).toHaveBeenCalledWith(3, ['read'], expect.any(AbortSignal));
 } finally { await server.dispose(); }
});
it('pins borrowed lease operations and identity while preserving its live cursor', async () => {
 const identity = {}; let cursor = 0;
 const close = vi.fn(async () => {});
 const replacement = vi.fn(async () => ({ done: false as const, value: Uint8Array.of(9) }));
 const lease = { identity, read: async () => ({ done: false as const, value: Uint8Array.of(++cursor) }), close };
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1, handles: { acquire: async () => lease } });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['read'], signal);
  lease.identity = {}; lease.read = replacement; lease.close = vi.fn(async () => {});
  expect(await server.read(opened.handle, 1, signal)).toEqual({ done: false, value: Uint8Array.of(1) });
  expect(await server.read(opened.handle, 1, signal)).toEqual({ done: false, value: Uint8Array.of(2) });
  await server.close(opened.handle, signal);
 } finally { await server.dispose(); }
 expect(close).toHaveBeenCalledOnce();
 expect(replacement).not.toHaveBeenCalled();
});
it.each([false, true])('counts a delayed descriptor close against retained capacity (failure=%s)', async fails => {
 let release!: () => void; let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const gate = new Promise<void>(resolve => { release = resolve; });
 const error = new Error('close failed'); let acquisitions = 0;
 const acquire = vi.fn(async () => ({ identity: {}, close: ++acquisitions === 1
  ? async () => { entered(); await gate; if (fails) throw error; }
  : async () => {},
 }));
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: { acquire } });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, [], signal);
 const closing = server.close(first.handle, signal);
 const outcome = closing.catch(cause => cause);
 await started;
 try {
  await expect(server.acquire(4, [], signal)).rejects.toMatchObject({ code: 'EMFILE' });
  expect(acquire).toHaveBeenCalledOnce();
 } finally { release(); await outcome; }
 expect(await outcome).toBe(fails ? error : undefined);
 try { await server.acquire(4, [], signal); } finally { await server.dispose(); }
});
it('keeps admitted rights when the lease provider mutates its acquisition arguments', async () => {
 const write = vi.fn(async () => 1);
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 2, handles: {
  acquire: async (_fd, rights) => {
   (rights as string[]).push('write');
   return { identity: {}, read: async () => ({ done: true, value: undefined }), write, close: async () => {} };
  },
 } });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['read'], signal);
  await expect(server.write(opened.handle, Uint8Array.of(7), signal)).rejects.toMatchObject({ code: 'EBADF' });
  expect(write).not.toHaveBeenCalled();
 } finally { await server.dispose(); }
});
it('retains descriptor transfer bounds and the caller handle binding', async () => {
 const acquire = vi.fn(async () => ({ identity: {}, write: async () => 1, close: async () => {} }));
 const options = { maxHandles: 1, maxIoBytes: 1, handles: { acquire } };
 const server = createDescriptorMaterialization(options);
 options.maxHandles = 2; options.maxIoBytes = 2;
 options.handles.acquire = vi.fn(async () => { throw new Error('replacement authority'); });
 const signal = new AbortController().signal;
 try {
  const opened = await server.acquire(3, ['write'], signal);
  await expect(server.write(opened.handle, Uint8Array.of(1, 2), signal)).rejects.toMatchObject({ code: 'EINVAL' });
  await expect(server.acquire(4, ['write'], signal)).rejects.toMatchObject({ code: 'EMFILE' });
  expect(acquire).toHaveBeenCalledOnce();
 } finally { await server.dispose(); }
});
it('keeps duplicate cursor ordering and identity until delayed close settles', async () => {
 const identity = {}; let release!: () => void; let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const read = vi.fn(async () => ({ done: false as const, value: Uint8Array.of(7) }));
 let acquisitions = 0;
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity, read, close: ++acquisitions === 1
   ? async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); }
   : async () => {},
  }),
 } });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, ['read'], signal);
 const closing = server.close(first.handle, signal); await started;
 const alias = await server.acquire(4, ['read'], signal);
 const reading = server.read(alias.handle, 1, signal);
 await Promise.resolve(); await Promise.resolve();
 const sameIdentity = alias.object === first.object;
 const prematureRead = read.mock.calls.length;
 release(); await closing; await reading; await server.dispose();
 expect(sameIdentity).toBe(true); expect(prematureRead).toBe(0);
});
it.each(['read', 'write', 'seek', 'stat'] as const)('refuses an unavailable %s operation during descriptor admission', async right => {
 const close = vi.fn(async () => {});
 const server = createDescriptorMaterialization({ handles: { acquire: async () => ({ identity: {}, close }) }, maxHandles: 1, maxIoBytes: 2 });
 await expect(server.acquire(3, [right], new AbortController().signal)).rejects.toMatchObject({ code: right === 'seek' ? 'ESPIPE' : 'ENOTSUP' });
 expect(close).toHaveBeenCalledOnce();
 await server.dispose();
 expect(close).toHaveBeenCalledOnce();
});
it('owns queued write frames and waits for settled progress before closing an alias', async () => {
 const identity = {}; let release!: () => void; let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const writes: Uint8Array[] = []; const close = vi.fn(async () => {});
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 2, handles: {
  acquire: async () => ({ identity, close,
   seek: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); },
   write: async bytes => { writes.push(new Uint8Array(bytes)); return 1; },
  }),
 } });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, ['seek'], signal);
 const alias = await server.acquire(4, ['write'], signal);
 const seeking = server.seek(first.handle, '0', signal); await started;
 const bytes = Buffer.from([0, 255]); const writing = server.write(alias.handle, bytes, signal);
 bytes.fill(9);
 const closing = server.close(alias.handle, signal);
 expect(writes).toEqual([]); expect(close).not.toHaveBeenCalled();
 release(); await seeking; expect(await writing).toBe(1); await closing;
 expect(writes).toEqual([Uint8Array.of(0, 255)]);
 expect(close).toHaveBeenCalledOnce(); await server.dispose();
 expect(close).toHaveBeenCalledTimes(2);
});
it('orders delayed cursor operations across duplicate leases before acknowledging the next read', async () => {
 const identity = {}; let cursor = 0; let release!: () => void;
 const reads: number[] = [];
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity, close: async () => {},
   seek: async position => { await new Promise<void>(resolve => { release = resolve; }); cursor = position; },
   read: async () => { reads.push(cursor); return { done: false, value: Uint8Array.of(cursor++) }; },
  }),
 } });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, ['seek', 'read'], signal);
 const duplicate = await server.acquire(4, ['read'], signal);
 const seeking = server.seek(first.handle, '7', signal);
 const reading = server.read(duplicate.handle, 1, signal);
 // Queue a turn without waiting for the cooperative backend operation.
 await Promise.resolve(); await Promise.resolve();
 expect(reads).toEqual([]);
 release(); await seeking;
 expect(await reading).toEqual({ done: false, value: Uint8Array.of(7) });
 await server.dispose();
});
it('retires correlation identity after the last borrowed lease closes', async () => {
 const identity = {};
 const server = createDescriptorMaterialization({ maxHandles: 2, maxIoBytes: 1,
  handles: { acquire: async () => ({ identity, close: async () => {} }) },
 });
 const signal = new AbortController().signal;
 const first = await server.acquire(3, [], signal);
 const alias = await server.acquire(4, [], signal);
 await server.close(first.handle, signal);
 const retained = await server.acquire(5, [], signal);
 expect(retained.object).toBe(alias.object);
 await server.close(alias.handle, signal); await server.close(retained.handle, signal);
 const reopened = await server.acquire(3, [], signal);
 expect(reopened.object).not.toBe(first.object);
 await server.dispose();
});

it('refuses missing rights before borrowing a caller descriptor', async () => {
 const acquire = vi.fn();
 const server = createDescriptorMaterialization({ handles: { acquire }, maxHandles: 1, maxIoBytes: 2 });
 await expect(server.acquire(3, Array(1), new AbortController().signal)).rejects.toMatchObject({ code: 'EINVAL' });
 expect(acquire).not.toHaveBeenCalled(); await server.dispose();
});

it('returns descriptor metadata without copying backend authority tokens', async () => {
 const stat = { type: 'file' as const, size: 1, mode: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, identityScope: Symbol('backend'), dev: 1, ino: 2 };
 const server = createDescriptorMaterialization({ handles: { acquire: async () => ({ identity: {}, stat: async () => stat, close: async () => {} }) }, maxHandles: 1, maxIoBytes: 2 });
 const signal = new AbortController().signal; const opened = await server.acquire(3, ['stat'], signal);
 expect(await server.stat(opened.handle, signal)).toEqual({ type: 'file', size: 1, mode: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 });
 expect(stat.identityScope).toBeTypeOf('symbol'); await server.dispose();
});

it('borrows admitted descriptors, preserves duplicate cursors and releases only leases', async () => {
 const identity={};let cursor=0;const close=vi.fn(async()=>{});
 const acquire=vi.fn(async()=>({identity,read:async(max:number)=>({done:false as const,value:Uint8Array.of(cursor++).slice(0,max)}),seek:async(position:number)=>{cursor=position;},close}));
 const server=createDescriptorMaterialization({handles:{acquire},maxHandles:2,maxIoBytes:8});
 const signal=new AbortController().signal;
 const a=await server.acquire(3,['read','seek'],signal);const b=await server.acquire(4,['read','seek'],signal);
 expect(a.object).toBe(b.object);
 expect(await server.read(a.handle,8,signal)).toEqual({done:false,value:Uint8Array.of(0)});
 expect(await server.read(b.handle,8,signal)).toEqual({done:false,value:Uint8Array.of(1)});
 await server.seek(a.handle,'7',signal);
 expect(await server.read(b.handle,8,signal)).toEqual({done:false,value:Uint8Array.of(7)});
 await expect(server.write(a.handle,Uint8Array.of(8),signal)).rejects.toMatchObject({code:'EBADF'});
 await expect(server.seek(a.handle,'9007199254740993',signal)).rejects.toMatchObject({code:'ENOTSUP'});
 await server.dispose();expect(close).toHaveBeenCalledTimes(2);
});

it('bounds operations, propagates short writes and closes late acquisition after disposal',async()=>{
 let release!:(lease:any)=>void;const close=vi.fn(async()=>{});
 const server=createDescriptorMaterialization({handles:{acquire:async()=>new Promise(resolve=>{release=resolve;})},maxHandles:1,maxIoBytes:2});
 const signal=new AbortController().signal;
 const opening=server.acquire(3,['write'],signal);const rejection=expect(opening).rejects.toThrow();
 const disposal=server.dispose();release({identity:{},write:async()=>1,close});
 await rejection;await disposal;expect(close).toHaveBeenCalledOnce();
 await expect(server.acquire(3,['write'],signal)).rejects.toMatchObject({code:'EBADF'});
});

it('acknowledges only canonical short write progress and preserves backend errors',async()=>{
 const error=Object.assign(new Error('quota'),{code:'ENOSPC'});let calls=0;
 const server=createDescriptorMaterialization({handles:{acquire:async()=>({identity:{},write:async()=>{if(calls++)throw error;return 1;},close:async()=>{}})},maxHandles:1,maxIoBytes:2});
 const signal=new AbortController().signal;const opened=await server.acquire(1,['write'],signal);
 expect(await server.write(opened.handle,Uint8Array.of(0,255),signal)).toBe(1);
 await expect(server.write(opened.handle,Uint8Array.of(2),signal)).rejects.toBe(error);
 await expect(server.write(opened.handle,new Uint8Array(3),signal)).rejects.toMatchObject({code:'EINVAL'});
 await server.dispose();
});
