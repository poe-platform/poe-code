import { sha256 } from '@noble/hashes/sha2.js';
import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';

/** Exact UTF-16 identity, including empty names and embedded NULs. Calls are sequential.
 * A bounded hash index points to name records; collisions use exact bounded comparisons. */
export class BiffPropertyNames {
  private readonly storage: WorkingStorage | undefined;
  private readonly index: IntegerTable | undefined;
  private readonly fallback: Set<string> | undefined;
  private initialized = false;
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly context: CapabilityContext, private readonly charge: (amount: number) => void) {
    this.storage = context.createWorkingStorage?.();
    if (this.storage) this.index = new IntegerTable({ allocate: length => this.allocate(length),
      read: (at, length) => this.read(at, length),
      write: async (at, bytes) => {
        const owned = new Uint8Array(bytes);
        try { await this.io(() => this.storage!.write(at, owned)); } finally { owned.fill(0); }
      }
    }, 64);
    else this.fallback = new Set();
    context.own(() => this.close());
  }
  private check(): void {
    this.context.signal.throwIfAborted();
    if (this.closed) throw new SsconvertError('invalid-request', 'BIFF property name index is closed');
  }
  private io<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => { this.check(); const value = await action(); this.check(); return value; });
    this.pending = result.then(() => undefined, () => undefined); return result;
  }
  private allocate(length: number): number {
    this.check(); const position = this.storage!.allocate(length); this.check(); return position;
  }
  private read(at: number, length: number): Promise<Uint8Array> {
    return this.io(async () => {
      const bytes = await this.storage!.read(at, length);
      if (bytes.length !== length) throw new SsconvertError('io', 'Truncated BIFF property name index');
      return new Uint8Array(bytes);
    });
  }
  private fingerprint(name: string): bigint {
    const hash = sha256.create(), buffer = new Uint8Array(Math.min(16384, name.length * 2)), view = new DataView(buffer.buffer);
    try {
      for (let at = 0; at < name.length;) {
        this.check(); const count = Math.min(buffer.length / 2, name.length - at);
        for (let i = 0; i < count; i++) view.setUint16(i * 2, name.charCodeAt(at + i), true);
        hash.update(buffer.subarray(0, count * 2)); at += count;
      }
      const digest = hash.digest(); return new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getBigUint64(0, true);
    } finally { buffer.fill(0); hash.destroy(); }
  }
  private async contains(name: string, head: bigint | undefined): Promise<boolean> {
    let position = Number(head ?? 0n);
    while (position) {
      this.charge(1);
      const record = new DataView((await this.read(position, 24)).buffer);
      position = record.getFloat64(0, true);
      if (record.getFloat64(8, true) !== name.length) continue;
      const start = record.getFloat64(16, true); let same = true;
      for (let at = 0; at < name.length;) {
        const count = Math.min(8192, name.length - at); this.charge(count);
        const bytes = await this.read(start + at * 2, count * 2);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < count; i++) if (view.getUint16(i * 2, true) !== name.charCodeAt(at + i)) { same = false; break; }
        if (!same) break; at += count;
      }
      if (same) return true;
    }
    return false;
  }
  async has(name: string): Promise<boolean> {
    this.check(); this.charge(name.length + 1);
    if (this.fallback) return this.fallback.has(name);
    const head = await this.index!.get(this.fingerprint(name)); this.check();
    return this.contains(name, head);
  }
  async add(name: string): Promise<void> {
    this.check(); this.charge(name.length + 1);
    if (this.fallback) { this.fallback.add(name); return; }
    if (!this.initialized) { this.allocate(8); this.check(); this.initialized = true; }
    const key = this.fingerprint(name), head = await this.index!.get(key); this.check();
    if (await this.contains(name, head)) return;
    const start = this.allocate(name.length * 2), buffer = new Uint8Array(Math.min(16384, name.length * 2));
    const view = new DataView(buffer.buffer);
    try {
      for (let at = 0; at < name.length;) {
        const count = Math.min(buffer.length / 2, name.length - at);
        for (let i = 0; i < count; i++) view.setUint16(i * 2, name.charCodeAt(at + i), true);
        await this.io(() => this.storage!.write(start + at * 2, buffer.subarray(0, count * 2))); at += count;
      }
    } finally { buffer.fill(0); }
    const record = new Uint8Array(24), descriptor = new DataView(record.buffer);
    descriptor.setFloat64(0, Number(head ?? 0n), true); descriptor.setFloat64(8, name.length, true); descriptor.setFloat64(16, start, true);
    const position = this.allocate(record.length);
    try { await this.io(() => this.storage!.write(position, record)); } finally { record.fill(0); }
    await this.index!.set(key, BigInt(position)); this.check();
  }
  close(): Promise<void> {
    this.closed = true; this.fallback?.clear();
    return this.closing ??= this.pending.then(async () => { await this.storage?.close(); });
  }
}
