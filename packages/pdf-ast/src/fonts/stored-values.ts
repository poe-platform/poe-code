import type { PdfPixelStorage } from "../ast.js";

const CAPACITY = Math.floor((4096 - 16) / 9);
interface Page {
  position: number;
  bytes: Uint8Array;
  view: DataView;
  dirty: boolean;
}

/** Sparse array semantics for CFF validation, with one cached linked page.
 * Undefined slots have an explicit tag, distinct from NaN and signed zero. */
export class StoredFontValues {
  private first = -1;
  private page: Page | undefined;
  private base = 0;
  private length = 0;
  private requests = 0;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {}
  clear(): void {
    this.signal?.throwIfAborted();
    this.length = 0;
  }
  private allocate(previous = -1): Page {
    const position = this.storage.allocate(4096);
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + 4096))
      throw new RangeError("Invalid font value allocation");
    const bytes = new Uint8Array(4096),
      view = new DataView(bytes.buffer);
    view.setFloat64(0, previous, true);
    view.setFloat64(8, -1, true);
    return { position, bytes, view, dirty: true };
  }
  private async save(): Promise<void> {
    if (!this.page?.dirty) return;
    await this.storage.write(
      this.page.position,
      this.page.bytes,
      this.signal ? { signal: this.signal } : undefined
    );
    this.signal?.throwIfAborted();
    this.page.dirty = false;
  }
  private async load(position: number): Promise<Page> {
    if (!Number.isSafeInteger(position) || position < 0)
      throw new RangeError("Invalid font value page");
    const bytes = await this.storage.read(
      position,
      4096,
      this.signal ? { signal: this.signal } : undefined
    );
    this.signal?.throwIfAborted();
    if (bytes.length !== 4096) throw new Error("Incomplete font value page");
    const owned = bytes.slice();
    return { position, bytes: owned, view: new DataView(owned.buffer), dirty: false };
  }
  private async seek(index: number): Promise<Page> {
    if (++this.requests % 4096 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.signal?.throwIfAborted();
    if (!this.page) {
      this.page = this.allocate();
      this.first = this.page.position;
    }
    if (index < this.base / 2) {
      await this.save();
      this.page = await this.load(this.first);
      this.base = 0;
    }
    while (index < this.base) {
      const previous = this.page.view.getFloat64(0, true);
      await this.save();
      this.page = await this.load(previous);
      this.base -= CAPACITY;
    }
    while (index >= this.base + CAPACITY) {
      const next = this.page.view.getFloat64(8, true);
      if (next < 0) {
        const page = this.allocate(this.page.position);
        this.page.view.setFloat64(8, page.position, true);
        this.page.dirty = true;
        await this.save();
        this.page = page;
      } else {
        await this.save();
        this.page = await this.load(next);
      }
      this.base += CAPACITY;
    }
    return this.page;
  }
  async get(index: number): Promise<number | undefined> {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) return undefined;
    const page = await this.seek(index),
      at = 16 + (index - this.base) * 9;
    return page.bytes[at] ? page.view.getFloat64(at + 1, true) : undefined;
  }
  async set(index: number, value: number | undefined): Promise<void> {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Invalid font value index");
    while (this.length < index) {
      const page = await this.seek(this.length),
        count = Math.min(index - this.length, this.base + CAPACITY - this.length);
      for (let i = 0; i < count; i++) page.bytes[16 + (this.length + i - this.base) * 9] = 0;
      page.dirty = true;
      this.length += count;
    }
    const page = await this.seek(index),
      at = 16 + (index - this.base) * 9;
    page.bytes[at] = value === undefined ? 0 : 1;
    if (value !== undefined) page.view.setFloat64(at + 1, value, true);
    page.dirty = true;
    this.length = Math.max(this.length, index + 1);
  }
  async slice(start: number, end: number): Promise<Array<number | undefined>> {
    start = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    end = end < 0 ? Math.max(0, this.length + end) : Math.min(end, this.length);
    const values: Array<number | undefined> = [];
    for (let index = start; index < end; index++) values.push(await this.get(index));
    return values;
  }
}
