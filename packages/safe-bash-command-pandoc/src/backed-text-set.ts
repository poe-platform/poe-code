import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedText, TextRange} from "./backed-text.js";

/** Collision-checked UTF-16 keys; both keys and bucket chains use caller storage. */
export class BackedTextSet {
  private readonly buckets: IntegerTable;
  private first = 0;
  private last = 0;
  constructor(private readonly storage: PagedStorage, private readonly text: BackedText) {this.buckets = new IntegerTable(storage, 64);}
  private async hash(source: Iterable<string> | AsyncIterable<string>): Promise<{bucket: bigint; units: number}> {
    let hash = 2166136261, units = 0;
    for await (const chunk of source) {
      units += chunk.length;
      for (let i = 0; i < chunk.length; i++) hash = Math.imul(hash ^ chunk.charCodeAt(i), 16777619) >>> 0;
    }
    return {bucket: BigInt(hash), units};
  }
  private async find(source: () => Iterable<string> | AsyncIterable<string>, units: number, bucket: bigint): Promise<number> {
    let position = Number(await this.buckets.get(bucket) ?? 0n);
    while (position) {
      const bytes = await this.storage.read(position, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const identity = position; position = view.getFloat64(0, true);
      const stored = {first: view.getFloat64(8, true), last: view.getFloat64(16, true), units: view.getFloat64(24, true)};
      if (stored.units !== units) continue;
      const right = this.text.chunks(stored);
      let current = "", offset = 0, equal = true;
      try {
        for await (const chunk of source()) {
          for (let i = 0; i < chunk.length; i++) {
            if (offset === current.length) {current = (await right.next()).value!; offset = 0;}
            if (chunk[i] !== current[offset++]) {equal = false; break;}
          }
          if (!equal) break;
        }
      } finally {await right.return(undefined);}
      if (equal) return identity;
    }
    return 0;
  }
  async has(value: TextRange | string): Promise<boolean> {
    if (typeof value === "string") {
      const {bucket, units} = await this.hash([value]);
      return Boolean(await this.find(() => [value], units, bucket));
    }
    const {bucket} = await this.hash(this.text.chunks(value));
    return Boolean(await this.find(() => this.text.chunks(value), value.units, bucket));
  }
  /** Return a stable identity for equal keys, allowing caller-backed value tables. */
  async add(value: TextRange | string): Promise<number> {
    if (typeof value === "string") return this.intern(() => [value]);
    const {bucket} = await this.hash(this.text.chunks(value));
    const existing = await this.find(() => this.text.chunks(value), value.units, bucket);
    return existing || this.insert(value, bucket);
  }
  /** Source must replay the same UTF-16 text. Existing keys allocate no text copy. */
  async intern(source: () => Iterable<string> | AsyncIterable<string>): Promise<number> {
    const {bucket, units} = await this.hash(source());
    const existing = await this.find(source, units, bucket);
    return existing || this.insert(await this.text.from(source()), bucket);
  }
  /** Insertion order, including keys appended while iterating. Only the current
   * key is materialized; membership and the iteration chain remain backed. */
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    let position = this.first;
    while (position) {
      const bytes = await this.storage.read(position, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const range = {first: view.getFloat64(8, true), last: view.getFloat64(16, true), units: view.getFloat64(24, true)};
      let value = "";
      for await (const chunk of this.text.chunks(range)) value += chunk;
      yield value;
      // Read after yielding: a consumer can append a dependency to the tail.
      const next = await this.storage.read(position + 32, 8);
      position = new DataView(next.buffer, next.byteOffset, next.length).getFloat64(0, true);
    }
  }
  private async insert(value: TextRange, bucket: bigint): Promise<number> {
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    [Number(await this.buckets.get(bucket) ?? 0n), value.first, value.last, value.units].forEach((number, index) => view.setFloat64(index * 8, number, true));
    const identity = await this.storage.append(bytes);
    await this.buckets.set(bucket, BigInt(identity));
    if (this.last) {
      const next = new Uint8Array(8); new DataView(next.buffer).setFloat64(0, identity, true);
      await this.storage.write(this.last + 32, next);
    } else this.first = identity;
    this.last = identity;
    return identity;
  }
}
