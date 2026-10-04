import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';
import type { BiffPropertySource } from './biff-encrypted-properties-write.js';

export type BiffPropertyBytes = Uint8Array | { readonly length: number; chunks(): Iterable<Uint8Array> };
export function* propertyChunks(value: BiffPropertyBytes): Iterable<Uint8Array> {
  if (value instanceof Uint8Array) {
    for (let at = 0; at < value.length; at += 16384) yield value.subarray(at, at + 16384);
  } else yield* value.chunks();
}

/** Consume lazy serialization once into caller storage; never retain emitted chunks. */
export async function stagePropertyBytes(value: BiffPropertyBytes, context: CapabilityContext): Promise<BiffPropertySource> {
  context.signal.throwIfAborted();
  if (!Number.isSafeInteger(value.length) || value.length < 0 || value.length > context.limits.outputBytes)
    throw new SsconvertError('resource-limit', 'Invalid BIFF property serialization size');
  const acquire = context.createWorkingStorage?.bind(context);
  if (!acquire) throw new SsconvertError('capability-denied', 'BIFF properties require caller working storage');
  let store: WorkingStorage | undefined, start = 0, closed = false, closing: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  const check = () => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError('invalid-request', 'BIFF serialized properties are closed');
  };
  const serial = <T>(operation: () => Promise<T>) => {
    const result = pending.then(() => { check(); return operation(); });
    pending = result.then(() => undefined, () => undefined); return result;
  };
  const source: BiffPropertySource = { size: value.length,
    read(position, count, options) { return serial(async () => {
      options?.signal?.throwIfAborted();
      if (!Number.isSafeInteger(position) || position < 0 || position > source.size || !Number.isSafeInteger(count) || count < 0)
        throw new SsconvertError('invalid-request', 'Invalid BIFF property range');
      const size = Math.min(16384, count, source.size - position);
      const bytes = await store!.read(start + position, size); check(); options?.signal?.throwIfAborted();
      if (bytes.length !== size) throw new SsconvertError('io', 'Truncated BIFF serialized properties');
      return new Uint8Array(bytes);
    }); },
    close() { closed = true; return closing ??= pending.then(async () => { await store?.close(); }); }
  };
  context.own(() => source.close());
  try {
    await serial(async () => {
      store = acquire(); check(); start = store.allocate(source.size); check();
      const buffer = new Uint8Array(16384); let count = 0, written = 0;
      const flush = async () => {
        if (!count) return;
        await store!.write(start + written, buffer.subarray(0, count)); check(); written += count; count = 0;
      };
      try {
        for (const part of propertyChunks(value)) {
          check();
          if (part.length > source.size - written - count) throw new SsconvertError('io', 'Invalid BIFF property serialization size');
          for (let at = 0; at < part.length;) {
            const size = Math.min(buffer.length - count, part.length - at);
            buffer.set(part.subarray(at, at + size), count); count += size; at += size;
            if (count === buffer.length) await flush();
          }
        }
        await flush();
        if (written !== source.size) throw new SsconvertError('io', 'Truncated BIFF property serialization');
      } finally { buffer.fill(0); }
    });
    return source;
  } catch (error) {
    try { await source.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'BIFF property serialization cleanup failed'); }
    throw error;
  } finally { value = new Uint8Array(); }
}
