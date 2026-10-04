import type { PagedStorage } from "@poe-code/safe-fs/storage";

/** Fixed-width continuation records; only the current offset stays in memory. */
export class StoredStack {
  private top = 0;
  constructor(private readonly storage: Pick<PagedStorage, "append" | "read">, private readonly width: number) {}
  async push(...values: number[]): Promise<void> {
    if (values.length !== this.width) throw new Error("Invalid HTML continuation width");
    const bytes = new Uint8Array((this.width + 1) * 8), view = new DataView(bytes.buffer);
    view.setFloat64(0, this.top, true);
    for (let index = 0; index < values.length; index++) view.setFloat64((index + 1) * 8, values[index]!, true);
    this.top = await this.storage.append(bytes);
  }
  async pop(): Promise<number[] | undefined> {
    if (!this.top) return undefined;
    const bytes = await this.storage.read(this.top, (this.width + 1) * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.top = view.getFloat64(0, true);
    return Array.from({ length: this.width }, (_, index) => view.getFloat64((index + 1) * 8, true));
  }
}
