import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext, type RangeSource, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';
import { Binary, invalidBiff } from './biff-binary.js';
import type { BiffPropertySection } from './biff-properties-layout.js';

interface Root { read: RangeSource['read']; check(): void; }
/** Property subviews retain coordinates; even scalar reads own their borrowed input. */
export class BiffPropertyRange implements RangeSource {
  constructor(private readonly root: Root, private readonly start: number, readonly size: number) {}
  check(position: number, length: number): void {
    this.root.check();
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position > this.size - length)
      invalidBiff('truncated binary data');
  }
  slice(position: number, length: number): BiffPropertyRange {
    this.check(position, length); return new BiffPropertyRange(this.root, this.start + position, length);
  }
  async read(position: number, count: number, options?: { readonly signal?: AbortSignal }): Promise<Uint8Array> {
    this.check(position, 0);
    if (!Number.isSafeInteger(count) || count < 0) invalidBiff('invalid property range');
    const length = Math.min(16384, count, this.size - position), bytes = new Uint8Array(length);
    try {
      for (let at = 0; at < length;) {
        options?.signal?.throwIfAborted();
        const part = await this.root.read(this.start + position + at, length - at, options);
        this.root.check(); options?.signal?.throwIfAborted();
        if (!part.length || part.length > length - at) invalidBiff('truncated binary data');
        bytes.set(part, at); at += part.length;
      }
      return bytes;
    } catch (error) { bytes.fill(0); throw error; }
  }
  async u16(at: number): Promise<number> { this.check(at, 2); return new Binary(await this.read(at, 2)).u16(0); }
  async u32(at: number): Promise<number> { this.check(at, 4); return new Binary(await this.read(at, 4)).u32(0); }
  async f64(at: number): Promise<number> { this.check(at, 8); return new Binary(await this.read(at, 8)).f64(0); }
}
export function propertyRange(input: Uint8Array | RangeSource, context: CapabilityContext): BiffPropertyRange {
  const size = input instanceof Uint8Array ? input.length : input.size;
  if (!Number.isSafeInteger(size) || size < 0) invalidBiff('invalid property source size');
  let closed = false;
  const read = input instanceof Uint8Array ? async (at: number, count: number) => input.subarray(at, at + count) : input.read.bind(input);
  let pending: Promise<unknown> = Promise.resolve();
  const root: Root = { check() {
    context.signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'BIFF property reader is closed');
  }, read(at, count, options) {
    const result = pending.then(async () => {
      root.check(); options?.signal?.throwIfAborted();
      const part = await read(at, count, options); root.check(); options?.signal?.throwIfAborted();
      if (!part.length || part.length > count) invalidBiff('truncated binary data');
      return new Uint8Array(part);
    });
    pending = result.then(() => undefined, () => undefined); return result;
  } };
  context.own(() => { closed = true; }); root.check();
  return new BiffPropertyRange(root, 0, size);
}

/** Index IO checks disposal around awaits and owns transient write buffers. */
function propertyIndexStorage(storage: WorkingStorage, range: BiffPropertyRange) {
  return {
    allocate(length: number) { range.check(0, 0); return storage.allocate(length); },
    async read(at: number, length: number) {
      range.check(0, 0); const bytes = await storage.read(at, length); range.check(0, 0); return bytes;
    },
    async write(at: number, bytes: Uint8Array) {
      range.check(0, 0); const owned = new Uint8Array(bytes);
      try { await storage.write(at, owned); range.check(0, 0); } finally { owned.fill(0); }
    }
  };
}

/** Validate all section intervals before replaying any descriptor. */
export async function* readPropertySectionRanges(file: BiffPropertyRange, admit: (count: number) => void,
  accountWork: (amount: number) => void, context: CapabilityContext): AsyncGenerator<BiffPropertySection> {
  file.check(0, 28); const header = new Binary(await file.read(0, 28));
  if (header.u16(0) !== 0xfffe || header.u16(2) > 1) invalidBiff('invalid property-set header');
  const count = header.u32(24), tableEnd = 28 + count * 20;
  file.check(28, count * 20); admit(count);
  accountWork(count * Math.ceil(Math.log2(count + 1)));
  const storage = context.createWorkingStorage?.();
  let failed = false;
  try {
    const backing = storage && propertyIndexStorage(storage, file);
    backing?.allocate(8);
    const offsets = backing ? new IntegerTable(backing, 64) : new Map<bigint, bigint>();
    const records = backing ? undefined : new Map<number, Uint8Array>();
    for (let i = 0; i < count; i++) {
      const bytes = await file.read(28 + i * 20, 20), offset = new Binary(bytes).u32(16);
      if (offset < tableEnd || offset % 4) invalidBiff('invalid property section offset');
      const size = await file.u32(offset); if (size < 8) invalidBiff('invalid property section size'); file.check(offset, size);
      const record = new Uint8Array(24); record.set(bytes); new DataView(record.buffer).setUint32(20, size, true);
      const position = backing ? backing.allocate(record.length) : i;
      if (backing) { try { await backing.write(position, record); } finally { record.fill(0); } }
      else records!.set(position, record);
      await offsets.set(BigInt(offset) << 32n | BigInt(i), BigInt(position)); file.check(0, 0);
    }
    const entries = async function* () {
      const ordered = offsets instanceof Map ? [...offsets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : offsets.entries();
      for await (const [, position] of ordered) {
        file.check(0, 0);
        const bytes = new Binary(backing ? await backing.read(Number(position), 24) : records!.get(Number(position))!);
        bytes.check(0, 24);
        const offset = bytes.u32(16), end = offset + bytes.u32(20);
        const guid = Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
        yield { guid, offset, end };
      }
    };
    let end = 0;
    for await (const section of entries()) {
      if (section.offset < end) invalidBiff('overlapping property sections'); end = section.end;
    }
    yield* entries();
  } catch (error) {
    failed = true;
    try { await storage?.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'BIFF property section index and cleanup failed'); }
    throw error;
  } finally { if (!failed) await storage?.close(); }
}
export async function readPropertyValueRanges(section: BiffPropertyRange, admit: (count: number) => void,
  accountWork: (amount: number) => void, context: CapabilityContext): Promise<Map<number, BiffPropertyRange>> {
  const count = await section.u32(4); section.check(8, count * 8); admit(count);
  accountWork(count * Math.ceil(Math.log2(count + 1)));
  const storage = context.createWorkingStorage?.();
  const values = new Map<number, BiffPropertyRange>();
  try {
    const backing = storage && propertyIndexStorage(storage, section);
    backing?.allocate(8);
    const ids = backing ? new IntegerTable(backing, 64) : new Map<bigint, bigint>();
    const offsets = backing ? new IntegerTable(backing, 64) : new Map<bigint, bigint>();
    for (let i = 0; i < count; i++) {
      const entry = new Binary(await section.read(8 + i * 8, 8)), id = BigInt(entry.u32(0)), at = entry.u32(4);
      if (at < 8 + count * 8 || at > section.size - 4) invalidBiff('invalid property offset');
      if (await ids.get(id) !== undefined) invalidBiff('duplicate property ID');
      section.check(0, 0); await ids.set(id, 1n); section.check(0, 0);
      if (await offsets.get(BigInt(at)) !== undefined) invalidBiff('overlapping property values');
      section.check(0, 0); await offsets.set(BigInt(at), id); section.check(0, 0);
    }
    const entries = offsets instanceof Map ? [...offsets].sort(([a], [b]) => Number(a - b)) : offsets.entries();
    let previous: { id: number; at: number } | undefined;
    for await (const [offset, id] of entries) {
      section.check(0, 0); const at = Number(offset);
      if (previous) values.set(previous.id, section.slice(previous.at, at - previous.at));
      previous = { id: Number(id), at };
    }
    if (previous) values.set(previous.id, section.slice(previous.at, section.size - previous.at));
  } catch (error) {
    try { await storage?.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'BIFF property index and cleanup failed'); }
    throw error;
  }
  await storage?.close(); section.check(0, 0);
  return values;
}
