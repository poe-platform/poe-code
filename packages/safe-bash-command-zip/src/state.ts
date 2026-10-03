import { ZipMetadataMap } from "safe-bash-zip-engine/zip/metadata";
import type { ZipMetadataFactory } from "safe-bash-zip-engine/zip-format";

/** The in-memory path is only for backends without scratch-storage capabilities. */
export class ZipStateMap<T> {
  private readonly records: ZipMetadataMap<unknown> | Map<string, unknown>;
  constructor(factory: ZipMetadataFactory | undefined, signal: AbortSignal,
    private readonly encode: (value: T) => unknown = value => value,
    private readonly decode: (value: unknown) => T = value => value as T) {
    this.records = factory ? new ZipMetadataMap(factory, signal) : new Map();
  }
  get size(): number { return this.records.size; }
  async get(key: string): Promise<T | undefined> {
    const value = await this.records.get(key);
    return value === undefined ? undefined : this.decode(value);
  }
  async has(key: string): Promise<boolean> { return this.records.has(key); }
  async set(key: string, value: T): Promise<void> { await this.records.set(key, this.encode(value)); }
  async delete(key: string): Promise<boolean> { return this.records.delete(key); }
  async *entries(): AsyncIterable<[string, T]> { for await (const [key, value] of this.records.entries()) yield [key, this.decode(value)]; }
  async *sortedEntries(): AsyncIterable<[string, T]> {
    const records = this.records instanceof ZipMetadataMap ? this.records.sortedEntries() : [...this.records.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for await (const [key, value] of records) yield [key, this.decode(value)];
  }
  async close(): Promise<void> { if (this.records instanceof ZipMetadataMap) await this.records.close(); else this.records.clear(); }
  async *values(): AsyncIterable<T> { for await (const [, value] of this.entries()) yield value; }
}

export class ZipStateList<T> {
  private count = 0;
  constructor(private readonly records: ZipStateMap<T>) {}
  get length(): number { return this.count; }
  async push(value: T): Promise<void> { await this.records.set(String(this.count++), value); }
  async get(index: number): Promise<T> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count) throw new RangeError("ZIP metadata index out of range");
    return (await this.records.get(String(index)))!;
  }
  async set(index: number, value: T): Promise<void> { await this.records.set(String(index), value); }
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> { for (let index = 0; index < this.count; index++) yield await this.get(index); }
}
