import { FsError } from '@poe-code/safe-fs/contracts/errors';
import { decodeFileOffset } from '@poe-code/safe-fs/contracts/object';
import type { ExactFileSeekHandle } from '@poe-code/safe-fs/contracts/object';
import type { FileStat } from '@poe-code/safe-fs/core';
import { admitCanonicalMetadata } from './canonical-metadata.js';

export type MaterializedDescriptorRight = 'read' | 'write' | 'seek' | 'stat';
/** Structurally matches safe-bash DescriptorLease. The caller owns descriptor
 * accounting and its open description; this adapter owns only the borrowed lease. */
export interface MaterializedDescriptorLease {
 readonly identity: object;
 readonly position?: number;
 readonly consumerClosed?: AbortSignal;
 read?(maxBytes: number, signal: AbortSignal): Promise<IteratorResult<Uint8Array>>;
 write?(bytes: Uint8Array, signal: AbortSignal): Promise<number>;
 seek?(position: number, signal: AbortSignal): Promise<void>;
 readonly exact?: ExactFileSeekHandle;
 stat?(signal: AbortSignal): Promise<FileStat>;
 close(): Promise<void>;
}
export interface MaterializedDescriptorHandles {
 acquire(fd: number, rights: readonly MaterializedDescriptorRight[], signal: AbortSignal): Promise<MaterializedDescriptorLease>;
}

/** Invocation-local descriptor capabilities. Opaque handles never select server
 * fds. Canonical lease operations settle before acknowledgment; cleanup drains
 * cooperative work and never undoes completed writes. */
export function createDescriptorMaterialization(options: { handles: MaterializedDescriptorHandles; maxHandles: number; maxIoBytes: number }) {
 options = { ...options };
 for (const value of [options.maxHandles, options.maxIoBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid descriptor bound');
 const acquire = options.handles.acquire.bind(options.handles);
 const records = new Map<string, { lease: MaterializedDescriptorLease; rights: Set<MaterializedDescriptorRight>; closing: boolean; pending: number; reads: AbortController; order: { object: string; references: number; tail: Promise<unknown> } }>();
 const identities = new Map<object, { object: string; references: number; tail: Promise<unknown> }>();
 const pending = new Set<Promise<unknown>>();
 const controller = new AbortController();
 const reads = new AbortController();
 let acquiring = 0; let closing = 0; let disposal: Promise<void> | undefined;
 function admitted<T>(signal: AbortSignal, work: (signal: AbortSignal, bytes?: Uint8Array) => Promise<T>, handle?: string, closeAdmission = false, bytes?: Uint8Array): Promise<T> {
  if (controller.signal.aborted) return Promise.reject(new FsError('EBADF'));
  const record = handle === undefined ? undefined : records.get(handle);
  if (handle !== undefined && (!record || record.closing)) return Promise.reject(new FsError('EBADF'));
  const combined = AbortSignal.any([signal, controller.signal]);
  if (combined.aborted) return Promise.reject(combined.reason);
  // Match the shell lease's bounded pending work; close has reserved capacity
  // so a full cursor queue cannot prevent its own retirement. Admission precedes
  // retaining write bytes, including when a duplicate description is blocked.
  if (record && !closeAdmission && record.pending >= 16) return Promise.reject(new FsError('EAGAIN'));
  const owned = bytes === undefined ? undefined : new Uint8Array(bytes);
  // Closing consumes this handle's admission now, while its accepted work and
  // duplicate descriptions retain their original cursor queue until drained.
  if (record && closeAdmission) {
   record.closing = true;
  }
  if (record) record.pending++;
  const predecessor = record?.order.tail;
  const task = (async () => {
   if (predecessor) await predecessor;
   // An admitted close has consumed ownership. Cancellation can reject before
   // admission, but cannot strand that retain behind accepted cursor work.
   // Disposal also drains this retirement instead of closing the lease twice.
   if (!closeAdmission) combined.throwIfAborted();
   return work(combined, owned);
  })();
  if (record) record.order.tail = task.catch(() => {});
  pending.add(task);
  void task.finally(() => { pending.delete(task); if (record) record.pending--; }).catch(() => {});
  // Publish the close's cursor barrier before cancellation listeners can
  // synchronously admit work through an alias of this description.
  if (record && closeAdmission) record.reads.abort(new FsError('EBADF'));
  return task;
 }
 function retained(handle: string, right: MaterializedDescriptorRight) {
  const record = records.get(handle);
  if (!record || !record.rights.has(right)) throw new FsError('EBADF');
  if (!(right === 'seek' ? record.lease.exact?.seek ?? record.lease.seek : record.lease[right])) throw new FsError(right === 'seek' ? 'ESPIPE' : 'ENOTSUP');
  return record.lease;
 }
 function bound(size: number) { if (!Number.isSafeInteger(size) || size < 0 || size > options.maxIoBytes) throw new FsError('EINVAL'); }
 return {
  acquire(fd: number, rights: readonly MaterializedDescriptorRight[], signal: AbortSignal) {
   return admitted(signal, async combined => {
    if (!Number.isSafeInteger(fd) || fd < 0 || !Array.isArray(rights)) throw new FsError('EINVAL');
    // Rights are indexed admission data, not an iterable authority. A custom
    // iterator or inherited slot must not manufacture a different capability.
    const count = rights.length;
    if (count > 4) throw new FsError('EINVAL');
    const requested: MaterializedDescriptorRight[] = Array.from({ length: count }, (_, index) => {
     if (!Object.hasOwn(rights, index)) throw new FsError('EINVAL');
     return rights[index];
    });
    for (const right of requested) if (!['read', 'write', 'seek', 'stat'].includes(right)) throw new FsError('EINVAL');
    if (records.size + acquiring + closing >= options.maxHandles) throw new FsError('EMFILE');
    acquiring++;
    let lease: MaterializedDescriptorLease | undefined;
    let close: (() => Promise<void>) | undefined;
    try {
     // The provider borrows its own argument copy, never our admitted rights.
     lease = await acquire(fd, [...requested], combined);
     close = lease.close.bind(lease);
     combined.throwIfAborted();
     // Borrow the admitted open description's operations once. Binding their
     // receiver preserves its live cursor without permitting later substitution.
     const exact = requested.includes('seek') ? lease.exact : undefined;
     const exactSeek = exact?.seek;
     lease = Object.freeze({
      identity: lease.identity, position: lease.position, consumerClosed: lease.consumerClosed,
      read: requested.includes('read') ? lease.read?.bind(lease) : undefined,
      write: requested.includes('write') ? lease.write?.bind(lease) : undefined,
      seek: requested.includes('seek') ? lease.seek?.bind(lease) : undefined,
      exact: exactSeek === undefined ? undefined : Object.freeze({ seek: exactSeek.bind(exact) }),
      stat: requested.includes('stat') ? lease.stat?.bind(lease) : undefined, close,
     });
     if (typeof lease.identity !== 'object' || lease.identity === null) throw new FsError('ENOTSUP');
     if (lease.position !== undefined && (!Number.isSafeInteger(lease.position) || lease.position < 0)) throw new FsError('ENOTSUP');
     for (const right of requested) if (typeof (right === 'seek' ? lease.exact?.seek ?? lease.seek : lease[right]) !== 'function') throw new FsError(right === 'seek' ? 'ESPIPE' : 'ENOTSUP');
     let order = identities.get(lease.identity);
     if (!order) { order = { object: crypto.randomUUID(), references: 0, tail: Promise.resolve() }; identities.set(lease.identity, order); }
     order.references++;
     const handle = crypto.randomUUID();
     records.set(handle, { lease, rights: new Set(requested), closing: false, pending: 0, reads: new AbortController(), order });
     return { handle, object: order.object, ...(lease.position === undefined ? {} : { position: lease.position }) };
    } catch (error) {
     if (close) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Descriptor acquisition cleanup failed', { cause: error }); } }
     throw error;
    } finally { acquiring--; }
   });
  },
  read(handle: string, maxBytes: number, signal: AbortSignal) {
   return admitted(signal, async combined => {
    bound(maxBytes); const lease = retained(handle, 'read');
    const readSignal = AbortSignal.any([combined, reads.signal, records.get(handle)!.reads.signal]);
    readSignal.throwIfAborted();
    const result = await lease.read!(maxBytes, readSignal);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new FsError('EIO', { syscall: 'read' });
    const done = result.done;
    if (done === true) {
     // A zero-byte request does not observe EOF on the caller's open
     // description. Refuse a broken lease receipt rather than retiring the
     // remote reader or silently manufacturing a successful upstream read.
     if (maxBytes === 0) throw new FsError('EIO', { syscall: 'read' });
     return { done: true as const, value: undefined };
    }
    if (done !== false && done !== undefined) throw new FsError('EIO', { syscall: 'read' });
    // Validate and copy one observation of the upstream fragment. Reading an
    // accessor again could transfer different bytes beyond the admitted bound.
    const bytes = result.value;
    if (!(bytes instanceof Uint8Array)) throw new FsError('EIO', { syscall: 'read' });
    const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(bytes) as number;
    // The lease contract permits empty fragments only for zero-byte requests.
    // A positive read must provide bytes or explicit EOF; silently forwarding
    // an empty fragment would allow a remote consumer to invent EOF or spin.
    if (length > maxBytes || (maxBytes > 0 && length === 0)) throw new FsError('EIO', { syscall: 'read' });
    return { done: false as const, value: new Uint8Array(bytes) };
   }, handle);
  },
  write(handle: string, bytes: Uint8Array, signal: AbortSignal) {
   if (!(bytes instanceof Uint8Array)) return Promise.reject(new FsError('EINVAL'));
   const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(bytes) as number;
   if (length > options.maxIoBytes) return Promise.reject(new FsError('EINVAL'));
   return admitted(signal, async (combined, owned) => {
    const lease = retained(handle, 'write');
    const writeSignal = lease.consumerClosed ? AbortSignal.any([combined, lease.consumerClosed]) : combined;
    writeSignal.throwIfAborted();
    const count = await lease.write!(owned!, writeSignal);
    // A completed canonical write retains its receipt even when destination
    // closure arrives before acknowledgment. Never turn settled progress into
    // a failed write or attempt to undo it.
    // A backend may transfer or change its borrowed carrier while settling.
    // The admitted span remains the bound for its native progress receipt.
    if (!Number.isSafeInteger(count) || count < 0 || count > length) throw new FsError('EIO', { syscall: 'write' });
    return count;
   }, handle, false, bytes);
  },
  seek(handle: string, position: string, signal: AbortSignal) {
   return admitted(signal, async combined => {
    const lease = retained(handle, 'seek'); const offset = decodeFileOffset(position);
    if (lease.exact) { await lease.exact.seek(offset, { signal: combined }); return; }
    if (offset > BigInt(Number.MAX_SAFE_INTEGER)) throw new FsError('ENOTSUP');
    await lease.seek!(Number(offset), combined);
   }, handle);
  },
  stat(handle: string, signal: AbortSignal) {
   return admitted(signal, async combined => {
    return admitCanonicalMetadata(await retained(handle, 'stat').stat!(combined), 'stat');
   }, handle);
  },
  close(handle: string, signal: AbortSignal) {
   return admitted(signal, async () => {
    const record = records.get(handle); if (!record) throw new FsError('EBADF');
    records.delete(handle);
    closing++;
    // A close in flight still retains the canonical open description. An alias
    // acquired meanwhile must share its identity and pending cursor queue.
    try { await record.lease.close(); }
    finally { closing--; if (--record.order.references === 0) identities.delete(record.lease.identity); }
   }, handle, true);
  },
  /** Retire read consumers before an outer callback barrier drains. Accepted
   * writes keep their original signals and settle on the shared cursor queue. */
  retireReads(handle?: string): void {
   if (handle === undefined) reads.abort(new FsError('EBADF'));
   else records.get(handle)?.reads.abort(new FsError('EBADF'));
  },
  dispose(): Promise<void> {
   if (disposal) return disposal;
   // Publish the shared barrier before canonical abort listeners can reenter.
   // Admission closes synchronously below; retirement starts after publication.
   disposal = Promise.resolve().then(async () => {
    await Promise.allSettled([...pending]);
    const closing = [...records.values()]; records.clear(); identities.clear();
    const results = await Promise.allSettled(closing.map(record => Promise.resolve().then(() => record.lease.close())));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Descriptor cleanup failed');
   });
   controller.abort(new FsError('EBADF'));
   return disposal;
  },
 };
}
