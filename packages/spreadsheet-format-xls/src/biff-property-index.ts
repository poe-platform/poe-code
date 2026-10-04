import { IntegerTable } from '@poe-code/safe-fs/storage';
import type { WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';
import { Binary, invalidBiff } from './biff-binary.js';

export interface BiffPropertyDescriptor { offset: number; size: number; block: number; name: string; }
/** Two bounded radix caches index UTF-16 name edges and stable range order.
 * Linked fixed-size records replay original descriptor order without an array. */
export class BiffPropertyDescriptorIndex {
  private readonly names: IntegerTable;
  private readonly ranges: IntegerTable;
  private node = 2n;
  private count = 0;
  private first = 0;
  private last = 0;
  constructor(private readonly storage: WorkingStorage, private readonly check: () => void) {
    storage.allocate(8); this.check();
    this.names = new IntegerTable(storage, 64); this.ranges = new IntegerTable(storage, 64);
  }
  async add(entry: BiffPropertyDescriptor): Promise<void> {
    this.check(); let node = 1n;
    const name = entry.name.toUpperCase();
    for (let i = 0; i < name.length; i++) {
      const key = node << 16n | BigInt(name.charCodeAt(i));
      let next = await this.names.get(key); this.check();
      if (next === undefined) { next = this.node++; await this.names.set(key, next); this.check(); }
      node = next;
    }
    const terminal = node << 16n;
    if (await this.names.get(terminal) !== undefined) invalidBiff('duplicate or invalid encrypted property stream name');
    this.check(); await this.names.set(terminal, 1n); this.check();
    await this.ranges.set(BigInt(entry.offset) << 32n | BigInt(this.count++), BigInt(entry.offset + entry.size)); this.check();
    const bytes = new Uint8Array(88), view = new DataView(bytes.buffer);
    view.setUint32(8, entry.offset, true); view.setUint32(12, entry.size, true); view.setUint16(16, entry.block, true);
    view.setUint16(18, entry.name.length, true);
    for (let i = 0; i < entry.name.length; i++) view.setUint16(20 + i * 2, entry.name.charCodeAt(i), true);
    const position = this.storage.allocate(bytes.length); this.check();
    try {
      await this.storage.write(position, bytes); this.check();
      if (this.last) { view.setFloat64(0, position, true); await this.storage.write(this.last, bytes.subarray(0, 8)); this.check(); }
      else this.first = position;
      this.last = position;
    } finally { bytes.fill(0); }
  }
  async validate(): Promise<void> {
    let end = 0n;
    for await (const [key, next] of this.ranges.entries()) {
      this.check(); if (key >> 32n < end) invalidBiff('overlapping encrypted property payloads'); end = next;
    }
  }
  async *entries(): AsyncIterable<BiffPropertyDescriptor> {
    let position = this.first;
    while (position) {
      this.check(); const bytes = new Binary(await this.storage.read(position, 88)); this.check();
      bytes.check(0, 88); position = bytes.f64(0);
      let name = ''; for (let i = 0; i < bytes.u16(18); i++) name += String.fromCharCode(bytes.u16(20 + i * 2));
      yield { offset: bytes.u32(8), size: bytes.u32(12), block: bytes.u16(16), name };
    }
  }
}
