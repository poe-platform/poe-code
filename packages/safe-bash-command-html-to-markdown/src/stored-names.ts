import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import type { TextStore } from "./stored-text.js";

/** Name buckets and values live in caller storage. Hash collisions compare the
 * original name in bounded chunks, so names are never identified by hash alone. */
export class StoredNames {
  private readonly buckets: IntegerTable;
  constructor(private readonly storage: PagedStorage, private readonly text: TextStore, private readonly cooperate?: (work: number) => void | Promise<void>) {
    this.buckets = new IntegerTable(storage, 64);
  }

  private async equal(a: number, b: number): Promise<boolean> {
    if ((await this.text.info(a)).length !== (await this.text.info(b)).length) return false;
    const left = this.text.chunks(a), right = this.text.chunks(b);
    let x = await left.next(), y = await right.next(), i = 0, j = 0;
    while (!x.done && !y.done) {
      const count = Math.min(x.value.length - i, y.value.length - j);
      await this.cooperate?.(count);
      if (x.value.slice(i, i + count) !== y.value.slice(j, j + count)) return false;
      i += count; j += count;
      if (i === x.value.length) { x = await left.next(); i = 0; }
      if (j === y.value.length) { y = await right.next(); j = 0; }
    }
    return x.done === y.done;
  }

  async find(name: number, create = false): Promise<{ entry: number; fresh: boolean }> {
    let hash = 0xcbf29ce484222325n;
    for await (const chunk of this.text.chunks(name)) {
      await this.cooperate?.(chunk.length);
      for (let index = 0; index < chunk.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(chunk.charCodeAt(index))) * 0x100000001b3n);
    }
    const first = Number(await this.buckets.get(hash) ?? 0n);
    for (let entry = first; entry;) {
      await this.cooperate?.(1);
      const bytes = await this.storage.read(entry, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (await this.equal(name, view.getFloat64(8, true))) return { entry, fresh: false };
      entry = view.getFloat64(0, true);
    }
    if (!create) return { entry: 0, fresh: false };
    const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
    view.setFloat64(0, first, true); view.setFloat64(8, name, true);
    const entry = await this.storage.append(bytes);
    await this.buckets.set(hash, BigInt(entry));
    return { entry, fresh: true };
  }

  async value(entry: number): Promise<number> {
    if (!entry) return 0;
    const bytes = await this.storage.read(entry + 16, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
  }

  async set(entry: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.storage.write(entry + 16, bytes);
  }
}
