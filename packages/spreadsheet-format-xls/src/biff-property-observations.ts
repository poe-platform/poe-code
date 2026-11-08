import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';

export interface BiffOriginalProperty { stream: string; section: number; id: number; key: string; unchanged: boolean; }
const streams = ['\u0005SummaryInformation', '\u0005DocumentSummaryInformation'];
/** Original identities are immutable and arrive once, in import order. Keep only
 * the comparison result, never decoded property values, in caller-backed records. */
export class BiffOriginalProperties {
  private readonly storage: WorkingStorage | undefined;
  private readonly indexes: IntegerTable[] | undefined;
  private readonly fallback: Map<string, BiffOriginalProperty> | undefined;
  private first = 0;
  private last = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly context: CapabilityContext, private readonly charge: (amount: number) => void) {
    this.storage = context.createWorkingStorage?.();
    if (this.storage) {
      const backing = { allocate: (length: number) => this.allocate(length),
        read: (at: number, length: number) => this.read(at, length), write: (at: number, bytes: Uint8Array) => this.write(at, bytes) };
      this.indexes = streams.map(() => new IntegerTable(backing, 64));
    } else this.fallback = new Map();
    context.own(() => this.close());
  }
  private check(): void {
    this.context.signal.throwIfAborted();
    if (this.closed) throw new SsconvertError('invalid-request', 'BIFF original properties are closed');
  }
  private allocate(length: number): number { this.check(); const position = this.storage!.allocate(length); this.check(); return position; }
  private io<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => { this.check(); const value = await action(); this.check(); return value; });
    this.pending = result.then(() => undefined, () => undefined); return result;
  }
  private read(at: number, length: number): Promise<Uint8Array> {
    return this.io(async () => {
      const bytes = await this.storage!.read(at, length);
      if (bytes.length !== length) throw new SsconvertError('io', 'Truncated BIFF original property index');
      return new Uint8Array(bytes);
    });
  }
  private async write(at: number, bytes: Uint8Array): Promise<void> {
    const owned = new Uint8Array(bytes);
    try { await this.io(() => this.storage!.write(at, owned)); } finally { owned.fill(0); }
  }
  async add(property: BiffOriginalProperty): Promise<void> {
    this.check(); this.charge(1 + property.key.length);
    const stream = streams.indexOf(property.stream);
    if (stream < 0 || !Number.isInteger(property.section) || property.section < 0 || property.section > 0xffffffff ||
      !Number.isInteger(property.id) || property.id < 0 || property.id > 0xffffffff)
      throw new SsconvertError('invalid-request', 'Invalid BIFF original property identity');
    if (this.fallback) {
      const key = `${property.stream}:${property.section}:${property.id}`;
      if (this.fallback.has(key)) throw new SsconvertError('invalid-request', 'Duplicate BIFF original property identity');
      this.fallback.set(key, { ...property }); return;
    }
    if (!this.first) this.allocate(8);
    const key = BigInt(property.section) << 32n | BigInt(property.id), index = this.indexes![stream]!;
    if (await index.get(key) !== undefined) throw new SsconvertError('invalid-request', 'Duplicate BIFF original property identity');
    this.check();
    const start = this.allocate(property.key.length * 2), buffer = new Uint8Array(Math.min(16384, property.key.length * 2)), view = new DataView(buffer.buffer);
    try {
      for (let at = 0; at < property.key.length;) {
        const count = Math.min(buffer.length / 2, property.key.length - at);
        for (let i = 0; i < count; i++) view.setUint16(i * 2, property.key.charCodeAt(at + i), true);
        await this.write(start + at * 2, buffer.subarray(0, count * 2)); at += count;
      }
    } finally { buffer.fill(0); }
    const bytes = new Uint8Array(32), record = new DataView(bytes.buffer);
    record.setUint32(8, property.section, true); record.setUint32(12, property.id, true);
    record.setFloat64(16, start, true); record.setUint32(24, property.key.length, true);
    record.setUint8(28, stream); record.setUint8(29, property.unchanged ? 1 : 0);
    const position = this.allocate(bytes.length); await this.write(position, bytes);
    if (this.last) { record.setFloat64(0, position, true); await this.write(this.last, bytes.subarray(0, 8)); }
    else this.first = position;
    this.last = position;
    await index.set(key, BigInt(position)); this.check();
  }
  private async decode(record: DataView): Promise<BiffOriginalProperty> {
    const length = record.getUint32(24, true), start = record.getFloat64(16, true); this.charge(length + 1);
    let key = '';
    for (let at = 0; at < length;) {
      const count = Math.min(8192, length - at), bytes = await this.read(start + at * 2, count * 2), view = new DataView(bytes.buffer);
      const units = new Uint16Array(count);
      for (let i = 0; i < count; i++) units[i] = view.getUint16(i * 2, true);
      key += String.fromCharCode(...units); at += count;
    }
    return { stream: streams[record.getUint8(28)]!, section: record.getUint32(8, true), id: record.getUint32(12, true), key, unchanged: record.getUint8(29) !== 0 };
  }
  async get(stream: string, section: number, id: number): Promise<BiffOriginalProperty | undefined> {
    this.check(); this.charge(1);
    if (!Number.isInteger(section) || section < 0 || section > 0xffffffff || !Number.isInteger(id) || id < 0 || id > 0xffffffff) return undefined;
    if (this.fallback) return this.fallback.get(`${stream}:${section}:${id}`);
    const index = this.indexes![streams.indexOf(stream)]; if (!index) return undefined;
    const position = await index.get(BigInt(section) << 32n | BigInt(id)); this.check();
    return position === undefined ? undefined : this.decode(new DataView((await this.read(Number(position), 32)).buffer));
  }
  async *values(): AsyncIterable<BiffOriginalProperty> {
    this.check();
    if (this.fallback) { for (const property of this.fallback.values()) { this.check(); yield property; } return; }
    let position = this.first;
    while (position) {
      const record = new DataView((await this.read(position, 32)).buffer); position = record.getFloat64(0, true);
      yield await this.decode(record);
    }
    this.check();
  }
  close(): Promise<void> {
    this.closed = true; this.fallback?.clear();
    return this.closing ??= this.pending.then(async () => { await this.storage?.close(); });
  }
}
