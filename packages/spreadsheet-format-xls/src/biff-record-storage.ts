import { SsconvertError, type CapabilityContext, type RangeSource, type WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import { Binary, invalidBiff, type BiffRecord } from "./biff-binary.js";
import { CfbBackendFailure } from "./cfb-range.js";

export interface BiffRecordSequence {
  readonly length: number;
  get(index: number): Promise<BiffRecord | undefined>;
}
export interface BiffRecordStore extends BiffRecordSequence {
  opcode(index: number): Promise<number | undefined>;
  atOffset(offset: number): Promise<BiffRecord | undefined>;
  /** Replacement bytes retain their original framing and are borrowed until settlement. */
  set(index: number, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
export type BiffRecords = BiffRecord[] | BiffRecordStore;
export function biffRecord(records: readonly BiffRecord[] | BiffRecordSequence, index: number): BiffRecord | undefined | Promise<BiffRecord | undefined> {
  return "get" in records ? records.get(index) : records[index];
}

/** Fixed descriptor and staging blocks; each requested payload is returned as owned bytes. */
export async function createBiffRecordStore(source: RangeSource, context: CapabilityContext): Promise<BiffRecordStore> {
  let closed = false, store: WorkingStorage | undefined, closing: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  let cache: Uint8Array | undefined, cacheGroup = -1, dirty = false;
  const payload = new Uint8Array(16384);
  let payloadStart = 0, payloadLength = 0;
  const close = () => {
    closed = true;
    return closing ??= pending.then(async () => { cache?.fill(0); cache = undefined; payload.fill(0); payloadLength = 0; await store?.close(); });
  };
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "BIFF record store is closed"); };
  context.own(close); check();
  const size = source.size, read = source.read.bind(source);
  if (!Number.isSafeInteger(size) || size < 0) invalidBiff("invalid source size");
  if (size > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  if (!context.createWorkingStorage) throw new SsconvertError("capability-denied", "BIFF record storage requires caller working storage");
  async function exact(position: number, length: number): Promise<Uint8Array> {
    check(); if (position > size - length) invalidBiff("truncated binary data");
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length;) {
      let chunk: Uint8Array;
      try { chunk = await read(position + offset, Math.min(16384, length - offset), { signal: context.signal }); }
      catch (error) { if (error instanceof CfbBackendFailure) throw error.cause; throw error; }
      check();
      if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > Math.min(16384, length - offset)) invalidBiff("truncated binary data");
      bytes.set(chunk, offset); offset += chunk.length;
    }
    return bytes;
  }
  // 682 descriptors of 24 bytes fit one bounded transfer, without split records.
  const blockRecords = 682, descriptorBytes = 24;
  let count = 0;
  try {
    store = context.createWorkingStorage(); check();
    const start = store.allocate(Math.floor(size / 4) * descriptorBytes), block = new Uint8Array(blockRecords * descriptorBytes);
    let buffered = 0, flushed = 0;
    for (let offset = 0; offset < size;) {
      const header = new Binary(await exact(offset, 4)), opcode = header.u16(0), length = header.u16(2);
      if (!opcode && !length) {
        let zero = true;
        for (let at = offset; at < size;) {
          const bytes = await exact(at, Math.min(16384, size - at));
          if (bytes.some(byte => byte !== 0)) { zero = false; break; }
          at += bytes.length;
        }
        if (zero) break;
      }
      if (offset + 4 > size - length) invalidBiff("truncated binary data");
      if (count >= (context.limits.workbookNodes ?? context.limits.inputBytes))
        throw new SsconvertError("resource-limit", "ssconvert BIFF record limit exceeded");
      const descriptor = new DataView(block.buffer, buffered * descriptorBytes, descriptorBytes);
      descriptor.setUint16(0, opcode, true); descriptor.setUint16(2, length, true);
      descriptor.setFloat64(8, offset, true); descriptor.setFloat64(16, 0, true);
      count++; buffered++; offset += length + 4;
      if (buffered === blockRecords) {
        await store.write(start + flushed * descriptorBytes, block); check();
        flushed += buffered; buffered = 0;
      }
    }
    if (buffered) { await store.write(start + flushed * descriptorBytes, block.subarray(0, buffered * descriptorBytes)); check(); }
    async function descriptor(index: number): Promise<DataView | undefined> {
      check();
      if (!Number.isSafeInteger(index) || index < 0 || index >= count) return undefined;
      const group = Math.floor(index / blockRecords);
      if (group !== cacheGroup) {
        if (dirty && cache) { await store!.write(start + cacheGroup * blockRecords * descriptorBytes, cache); check(); dirty = false; }
        cache = await store!.read(start + group * blockRecords * descriptorBytes, Math.min(blockRecords, count - group * blockRecords) * descriptorBytes);
        check(); cacheGroup = group;
      }
      return new DataView(cache!.buffer, cache!.byteOffset + index % blockRecords * descriptorBytes, descriptorBytes);
    }
    async function get(index: number): Promise<BiffRecord | undefined> {
      const desc = await descriptor(index); if (!desc) return undefined;
      const opcode = desc.getUint16(0, true), length = desc.getUint16(2, true), offset = desc.getFloat64(8, true), address = desc.getFloat64(16, true);
      let bytes: Uint8Array;
      if (!address) bytes = await exact(offset + 4, length);
      else {
        bytes = new Uint8Array(length);
        try {
          for (let at = 0; at < length;) {
            if (payloadLength && address + at >= payloadStart) {
              const within = address + at - payloadStart, count = Math.min(length - at, payloadLength - within);
              if (count <= 0) throw new SsconvertError("invalid-request", "Invalid staged BIFF record");
              bytes.set(payload.subarray(within, within + count), at); at += count;
            } else {
              const count = Math.min(16384, length - at, payloadLength ? payloadStart - address - at : Infinity);
              bytes.set(await store!.read(address + at, count), at); check(); at += count;
            }
          }
        } catch (error) { bytes.fill(0); throw error; }
      }
      return { opcode, offset, data: new Binary(bytes) };
    }
    function serial<T>(operation: () => Promise<T>): Promise<T> {
      const result = pending.then(() => { check(); return operation(); });
      pending = result.then(() => undefined, () => undefined); return result;
    }
    return Object.freeze({ length: count, close,
      get(index: number) { return serial(() => get(index)); },
      opcode(index: number) { return serial(async () => (await descriptor(index))?.getUint16(0, true)); },
      atOffset(offset: number) { return serial(async () => {
        let low = 0, high = count;
        while (low < high) {
          const mid = low + Math.floor((high - low) / 2), candidate = (await descriptor(mid))!.getFloat64(8, true);
          if (candidate < offset) low = mid + 1; else high = mid;
        }
        if ((await descriptor(low))?.getFloat64(8, true) !== offset) return undefined;
        return get(low);
      }); },
      set(index: number, bytes: Uint8Array) { return serial(async () => {
        const desc = await descriptor(index);
        if (!desc || bytes.length !== desc.getUint16(2, true)) throw new SsconvertError("invalid-request", "Invalid BIFF replacement record");
        try {
          const address = store!.allocate(bytes.length);
          for (let at = 0; at < bytes.length;) {
            if (!payloadLength) payloadStart = address + at;
            const count = Math.min(payload.length - payloadLength, bytes.length - at);
            payload.set(bytes.subarray(at, at + count), payloadLength); payloadLength += count; at += count;
            if (payloadLength === payload.length) { await store!.write(payloadStart, payload); check(); payloadLength = 0; }
          }
          desc.setFloat64(16, address, true); dirty = true;
        } catch (error) { closed = true; payload.fill(0); payloadLength = 0; throw error; }
      }); }
    });
  } catch (error) {
    const failure = context.signal.aborted ? context.signal.reason : error;
    try { await close(); } catch (cleanup) { throw new AggregateError([failure, cleanup], "BIFF indexing and cleanup failed"); }
    throw failure;
  }
}

export interface BiffRecordSelection extends BiffRecordSequence { append(index: number): Promise<void>; }

/** Share one append block and one read block across sheet selections. */
export function createBiffRecordSelections(records: BiffRecordSequence, context: CapabilityContext) {
  const block = new Uint8Array(16384);
  let active: { store: WorkingStorage } | undefined, buffered = 0, position = 0, closed = false;
  let readOwner: WorkingStorage | undefined, readGroup = -1, readCache: Uint8Array | undefined;
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "BIFF selections are closed"); };
  context.own(() => { closed = true; block.fill(0); readCache = undefined; active = undefined; }); check();
  async function flush() {
    check();
    if (buffered) { await active!.store.write(position, block.subarray(0, buffered * 8)); check(); buffered = 0; }
  }
  return () => {
    check();
    if (!context.createWorkingStorage) throw new SsconvertError("capability-denied", "BIFF selections require caller working storage");
    let store: WorkingStorage | undefined = undefined, disposed = false, closing: Promise<void> | undefined;
    const checkEntry = () => { check(); if (disposed) throw new SsconvertError("invalid-request", "BIFF selection is closed"); };
    context.own(() => { disposed = true; return closing ??= store?.close() ?? Promise.resolve(); });
    checkEntry(); store = context.createWorkingStorage(); checkEntry();
    const entry = { store }, start = store.allocate(0);
    let length = 0;
    return Object.freeze<BiffRecordSelection>({ get length() { return length; },
      async append(index) {
        checkEntry();
        if (!Number.isSafeInteger(index) || index < 0 || index >= records.length) throw new SsconvertError("invalid-request", "Invalid BIFF selection index");
        if (active !== entry) { await flush(); checkEntry(); active = entry; }
        const address = entry.store.allocate(8);
        if (!buffered) position = address;
        new DataView(block.buffer).setFloat64(buffered++ * 8, index, true); length++;
        readCache = undefined;
        if (buffered === 2048) await flush();
      },
      async get(index) {
        checkEntry(); if (!Number.isSafeInteger(index) || index < 0 || index >= length) return undefined;
        await flush(); checkEntry();
        const group = Math.floor(index / 2048);
        if (!readCache || readOwner !== entry.store || readGroup !== group) {
          readCache = await entry.store.read(start + group * 16384, Math.min(2048, length - group * 2048) * 8); checkEntry();
          readOwner = entry.store; readGroup = group;
        }
        const selected = new DataView(readCache.buffer, readCache.byteOffset).getFloat64(index % 2048 * 8, true);
        const record = await records.get(selected); checkEntry(); return record;
      }
    });
  };
}
