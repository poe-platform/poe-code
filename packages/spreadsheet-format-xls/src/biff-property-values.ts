import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';
import { Binary, invalidBiff } from './biff-binary.js';
import { BiffPropertyRange } from './biff-property-range.js';

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
  private readonly root = { read: (at: number, count: number) => this.read(at, count), check: () => this.check() };
  constructor(private readonly context: CapabilityContext, private readonly charge: (amount: number) => void) {
    this.storage = context.createWorkingStorage?.();
    if (this.storage) this.index = new IntegerTable({ allocate: length => this.allocate(length),
      read: (at, length) => this.read(at, length), write: (at, bytes) => this.write(at, bytes) }, 64);
    else this.fallback = new Map();
    context.own(() => this.close());
  }
  get size(): number { this.check(); return this.fallback?.size ?? this.count; }
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
  async set(id: number, value: BiffPropertyRange): Promise<void> {
    this.check();
    if (this.fallback) { this.fallback.set(id, value); return; }
    this.charge(value.size);
    if (!this.initialized) { this.allocate(8); this.initialized = true; }
    const existing = await this.index!.get(BigInt(id)); this.check();
    const data = this.allocate(value.size);
    for (let at = 0; at < value.size;) {
      const bytes = await value.read(at, Math.min(16384, value.size - at));
      try { await this.write(data + at, bytes); at += bytes.length; } finally { bytes.fill(0); }
    }
    const record = new Uint8Array(32), view = new DataView(record.buffer);
    view.setFloat64(8, data, true); view.setFloat64(16, value.size, true); view.setUint32(24, id, true); view.setUint32(28, 1, true);
    if (existing) { await this.write(Number(existing) + 8, record.subarray(8, 24)); return; }
    const position = this.allocate(32); await this.write(position, record);
    if (this.last) { view.setFloat64(0, position, true); await this.write(this.last, record.subarray(0, 8)); }
    else this.first = position;
    this.last = position;
    await this.index!.set(BigInt(id), BigInt(position)); this.check(); this.count++;
  }
  async delete(id: number): Promise<boolean> {
    this.check(); if (this.fallback) return this.fallback.delete(id);
    const position = await this.index!.get(BigInt(id)); this.check();
    if (!position) return false;
    await this.write(Number(position) + 28, new Uint8Array(4));
    await this.index!.set(BigInt(id), 0n); this.check(); this.count--; return true;
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
