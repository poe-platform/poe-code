import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import type { SofficeSnapshot } from "./retained-input.js";

export class RetainedSpans {
  private readonly values: IntegerTable;
  count = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal, private readonly enabled = true) { this.values = new IntegerTable(storage); }
  async add(span: SofficeSnapshot): Promise<void> {
    if (!this.enabled) return;
    await this.values.set(BigInt(this.count * 2), BigInt(span.position));
    await this.values.set(BigInt(this.count * 2 + 1), BigInt(span.size)); this.count++;
  }
  async finish(first = 0): Promise<SofficeSnapshot> {
    let size = 0;
    for (let index = first; index < this.count; index++) size += Number(await this.values.get(BigInt(index * 2 + 1)));
    const position = this.storage.allocate(size); let written = 0;
    for (let index = first; index < this.count; index++) {
      const start = Number(await this.values.get(BigInt(index * 2))), length = Number(await this.values.get(BigInt(index * 2 + 1)));
      for (let offset = 0; offset < length; offset += 16384) {
        this.signal.throwIfAborted();
        const bytes = new Uint8Array(await this.storage.read(start + offset, Math.min(16384, length - offset)));
        await this.storage.write(position + written, bytes); written += bytes.length;
      }
    }
    return { position, size };
  }
}

