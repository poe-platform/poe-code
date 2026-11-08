import type { PdfPixelStorage } from "../ast.js";
import type { CffCodeSource } from "../vendor/pdfjs-fonts.mjs";
import { StoredFontValues } from "./stored-values.js";

export interface StoredFontByteRange extends CffCodeSource {
  readonly start: number;
}

interface Page {
  position: number;
  bytes: Uint8Array;
  dirty: boolean;
}

/** Append-only converted programs, addressed through caller-backed page offsets.
 * Truncation reuses rejected conversion scratch without retaining its bytes. */
export class StoredFontBytes {
  private readonly offsets: StoredFontValues;
  private readonly pages = new Map<number, Page>();
  private size = 0;
  private requests = 0;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {
    this.offsets = new StoredFontValues(storage, signal);
  }
  get length(): number {
    return this.size;
  }
  truncate(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.size)
      throw new RangeError("Invalid converted font length");
    this.size = length;
  }
  private async save(page: Page) {
    if (!page.dirty) return;
    this.signal?.throwIfAborted();
    await this.storage.write(
      page.position,
      page.bytes,
      this.signal ? { signal: this.signal } : undefined
    );
    this.signal?.throwIfAborted();
    page.dirty = false;
  }
  async flush(): Promise<void> {
    for (const page of this.pages.values()) await this.save(page);
  }
  private async page(index: number): Promise<Page> {
    if (++this.requests % 4096 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.signal?.throwIfAborted();
    let page = this.pages.get(index);
    if (page) {
      this.pages.delete(index);
      this.pages.set(index, page);
      return page;
    }
    if (this.pages.size === 2) {
      const [key, oldest] = this.pages.entries().next().value!;
      await this.save(oldest);
      this.pages.delete(key);
    }
    let position = await this.offsets.get(index);
    if (position === undefined) {
      position = this.storage.allocate(4096);
      if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + 4096))
        throw new RangeError("Invalid converted font allocation");
      await this.offsets.set(index, position);
      page = { position, bytes: new Uint8Array(4096), dirty: true };
    } else {
      const bytes = await this.storage.read(
        position,
        4096,
        this.signal ? { signal: this.signal } : undefined
      );
      this.signal?.throwIfAborted();
      if (bytes.length !== 4096) throw new Error("Incomplete converted font page");
      page = { position, bytes: bytes.slice(), dirty: false };
    }
    this.pages.set(index, page);
    return page;
  }
  async push(...bytes: number[]): Promise<void> {
    for (let at = 0; at < bytes.length; ) {
      const page = await this.page(Math.floor(this.size / 4096)),
        offset = this.size % 4096,
        count = Math.min(bytes.length - at, 4096 - offset);
      for (let i = 0; i < count; i++) page.bytes[offset + i] = bytes[at + i]!;
      page.dirty = true;
      at += count;
      this.size += count;
    }
  }
  async byte(at: number): Promise<number | undefined> {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(at) || at < 0 || at >= this.size) return undefined;
    return (await this.page(Math.floor(at / 4096))).bytes[at % 4096];
  }
  range(start = 0, end = this.size): StoredFontByteRange {
    start = Math.max(0, Math.min(this.size, Math.trunc(start) || 0));
    end = Math.max(start, Math.min(this.size, Math.trunc(end) || 0));
    const length = end - start;
    return {
      start,
      length,
      byte: async (at) => {
        return Number.isInteger(at) && at >= 0 && at < length ? this.byte(start + at) : undefined;
      },
      int: async (at, bytes) => {
        if (!Number.isInteger(at) || at < 0 || at + bytes > length)
          throw new RangeError("Offset is outside the bounds of the DataView");
        let value = 0;
        for (let i = 0; i < bytes; i++) value = (value << 8) | (await this.byte(start + at + i))!;
        return bytes === 2 ? (value << 16) >> 16 : value;
      }
    };
  }
}
