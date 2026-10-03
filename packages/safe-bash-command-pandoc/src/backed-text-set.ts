import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedText, TextRange} from "./backed-text.js";

/** Collision-checked UTF-16 keys; both keys and bucket chains use caller storage. */
export class BackedTextSet {
  private readonly buckets: IntegerTable;
  constructor(private readonly storage: PagedStorage, private readonly text: BackedText) {this.buckets = new IntegerTable(storage, 64);}
  private async hash(value: TextRange): Promise<bigint> {
    let hash = 2166136261;
    for await (const chunk of this.text.chunks(value)) for (let i = 0; i < chunk.length; i++) hash = Math.imul(hash ^ chunk.charCodeAt(i), 16777619) >>> 0;
    return BigInt(hash);
  }
  private async find(value: TextRange, bucket: bigint): Promise<number> {
    let position = Number(await this.buckets.get(bucket) ?? 0n);
    while (position) {
      const bytes = await this.storage.read(position, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const identity = position; position = view.getFloat64(0, true);
      const stored = {first: view.getFloat64(8, true), last: view.getFloat64(16, true), units: view.getFloat64(24, true)};
      if (stored.units !== value.units) continue;
      const right = this.text.chunks(stored);
      let current = "", offset = 0, equal = true;
      try {
        for await (const chunk of this.text.chunks(value)) {
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
  async has(value: TextRange): Promise<boolean> {return Boolean(await this.find(value, await this.hash(value)));}
  /** Return a stable identity for equal keys, allowing caller-backed value tables. */
  async add(value: TextRange): Promise<number> {
    const bucket = await this.hash(value);
    const existing = await this.find(value, bucket);
    if (existing) return existing;
    const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
    [Number(await this.buckets.get(bucket) ?? 0n), value.first, value.last, value.units].forEach((number, index) => view.setFloat64(index * 8, number, true));
    const identity = await this.storage.append(bytes);
    await this.buckets.set(bucket, BigInt(identity));
    return identity;
  }
}
