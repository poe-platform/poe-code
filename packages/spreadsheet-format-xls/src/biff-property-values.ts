import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';
import { Binary, invalidBiff } from './biff-binary.js';
import { BiffPropertyRange, propertyRange } from './biff-property-range.js';

/** Mutable insertion order with immutable payload snapshots. Deleted payloads remain
 * readable until close, so values can be moved between independently edited sections. */
export class BiffMutablePropertyValues {
  private readonly storage: WorkingStorage | undefined;
  private readonly index: IntegerTable | undefined;
  private readonly fallback: Map<number, BiffPropertyRange> | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private closed = false;
  private initialized = false;
  private first = 0;
  private last = 0;
  private count = 0;
  private paddedSize = 0;
  private readonly root = { read: (at: number, count: number) => this.read(at, count), check: () => this.check() };
  constructor(private readonly context: CapabilityContext, private readonly charge: (amount: number) => void) {
    this.storage = context.createWorkingStorage?.();
    if (this.storage) this.index = new IntegerTable({ allocate: length => this.allocate(length),
      read: (at, length) => this.read(at, length), write: (at, bytes) => this.write(at, bytes) }, 64);
    else this.fallback = new Map();
    context.own(() => this.close());
  }
  get size(): number { this.check(); return this.fallback?.size ?? this.count; }
  get serializedSize(): number { return 8 + this.size * 8 + this.paddedSize; }
  private check(): void {
    this.context.signal.throwIfAborted();
    if (this.closed) throw new SsconvertError('invalid-request', 'BIFF mutable property values are closed');
  }
  private allocate(length: number): number { this.check(); return this.storage!.allocate(length); }
  private io<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => { this.check(); const value = await action(); this.check(); return value; });
    this.pending = result.then(() => undefined, () => undefined); return result;
  }
  private read(at: number, length: number): Promise<Uint8Array> {
    return this.io(async () => {
      const bytes = await this.storage!.read(at, length);
      if (bytes.length !== length) invalidBiff('truncated mutable property values');
      return new Uint8Array(bytes);
    });
  }
  private async write(at: number, bytes: Uint8Array): Promise<void> {
    const owned = new Uint8Array(bytes);
    try { await this.io(() => this.storage!.write(at, owned)); } finally { owned.fill(0); }
  }
  async get(id: number): Promise<BiffPropertyRange | undefined> {
    this.check(); if (this.fallback) return this.fallback.get(id);
    const position = await this.index!.get(BigInt(id)); this.check();
    if (!position) return undefined;
    const record = new Binary(await this.read(Number(position), 32));
    return new BiffPropertyRange(this.root, record.f64(8), record.f64(16));
  }
  async set(id: number, value: BiffPropertyRange | { readonly size: number; chunks(): AsyncIterable<Uint8Array> }): Promise<void> {
    this.check();
    if (!(value instanceof BiffPropertyRange) && (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > this.context.limits.outputBytes))
      throw new SsconvertError('resource-limit', 'Invalid BIFF mutable property serialization size');
    if (this.fallback && value instanceof BiffPropertyRange) {
      const previous = this.fallback.get(id);
      this.fallback.set(id, value); this.paddedSize += Math.ceil(value.size / 4) * 4 - Math.ceil((previous?.size ?? 0) / 4) * 4; return;
    }
    const chunks = async function* () {
      if (!(value instanceof BiffPropertyRange)) { yield* value.chunks(); return; }
      for (let at = 0; at < value.size;) {
        const bytes = await value.read(at, Math.min(16384, value.size - at));
        try { at += bytes.length; yield bytes; } finally { bytes.fill(0); }
      }
    };
    if (this.fallback) {
      const bytes = new Uint8Array(value.size); let at = 0;
      for await (const part of chunks()) {
        this.check();
        if (part.length > bytes.length - at) invalidBiff('invalid mutable property serialization size');
        bytes.set(part, at); at += part.length;
      }
      this.check();
      if (at !== bytes.length) invalidBiff('truncated mutable property serialization');
      const previous = this.fallback.get(id);
      this.fallback.set(id, propertyRange(bytes, this.context));
      this.paddedSize += Math.ceil(bytes.length / 4) * 4 - Math.ceil((previous?.size ?? 0) / 4) * 4; return;
    }
    this.charge(value.size);
    if (!this.initialized) { this.allocate(8); this.initialized = true; }
    const existing = await this.index!.get(BigInt(id)); this.check();
    const previousSize = existing ? new Binary(await this.read(Number(existing) + 16, 8)).f64(0) : 0;
    const data = this.allocate(value.size);
    const buffer = new Uint8Array(Math.min(16384, value.size)); let written = 0, used = 0;
    try {
      for await (const part of chunks()) {
        this.check();
        if (part.length > value.size - written - used) invalidBiff('invalid mutable property serialization size');
        for (let at = 0; at < part.length;) {
          const count = Math.min(buffer.length - used, part.length - at);
          buffer.set(part.subarray(at, at + count), used); used += count; at += count;
          if (used === buffer.length) { await this.write(data + written, buffer); written += used; used = 0; }
        }
      }
      this.check();
      if (written + used !== value.size) invalidBiff('truncated mutable property serialization');
      if (used) await this.write(data + written, buffer.subarray(0, used));
    } finally { buffer.fill(0); }
    const record = new Uint8Array(32), view = new DataView(record.buffer);
    view.setFloat64(8, data, true); view.setFloat64(16, value.size, true); view.setUint32(24, id, true); view.setUint32(28, 1, true);
    if (existing) {
      await this.write(Number(existing) + 8, record.subarray(8, 24));
      this.paddedSize += Math.ceil(value.size / 4) * 4 - Math.ceil(previousSize / 4) * 4; return;
    }
    const position = this.allocate(32); await this.write(position, record);
    if (this.last) { view.setFloat64(0, position, true); await this.write(this.last, record.subarray(0, 8)); }
    else this.first = position;
    this.last = position;
    await this.index!.set(BigInt(id), BigInt(position)); this.check(); this.count++; this.paddedSize += Math.ceil(value.size / 4) * 4;
  }
  async delete(id: number): Promise<boolean> {
    this.check();
    if (this.fallback) {
      const previous = this.fallback.get(id); if (!previous) return false;
      this.fallback.delete(id); this.paddedSize -= Math.ceil(previous.size / 4) * 4; return true;
    }
    const position = await this.index!.get(BigInt(id)); this.check();
    if (!position) return false;
    const previousSize = new Binary(await this.read(Number(position) + 16, 8)).f64(0);
    await this.write(Number(position) + 28, new Uint8Array(4));
    await this.index!.set(BigInt(id), 0n); this.check(); this.count--; this.paddedSize -= Math.ceil(previousSize / 4) * 4; return true;
  }
  async *entries(): AsyncGenerator<readonly [number, BiffPropertyRange]> {
    this.check();
    if (this.fallback) { for (const entry of this.fallback) { this.check(); yield entry; } return; }
    let position = this.first;
    while (position) {
      const record = new Binary(await this.read(position, 32)); position = record.f64(0);
      if (record.u32(28)) yield [record.u32(24), new BiffPropertyRange(this.root, record.f64(8), record.f64(16))];
    }
    this.check();
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true; this.fallback?.clear();
      this.closing = this.pending.then(async () => { await this.storage?.close(); });
    }
    return this.closing;
  }
}
