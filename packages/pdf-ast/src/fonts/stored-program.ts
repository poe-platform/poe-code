import type { StoredCidMap } from "./stored-cid-map.js";
import { PdfError } from "../errors.js";

interface Page {
  start: number;
  bytes: Uint8Array;
  dirty: boolean;
}
function index(value: number, length: number): number {
  value = Math.trunc(value) || 0;
  return value < 0 ? Math.max(0, length + value) : Math.min(value, length);
}

/** Mutable, caller-owned program bytes. All views share two detached pages so
 * PDF.js repairs are coherent without retaining the complete encoded font. */
export class FontProgramStore {
  private readonly pages = new Map<number, Page>();
  private requests = 0;
  constructor(
    readonly source: StoredCidMap,
    private readonly options: { signal?: AbortSignal; onAllocation?: (bytes: number) => void } = {}
  ) {
    options.onAllocation?.(32768);
    if (
      !Number.isSafeInteger(source.byteLength) ||
      source.byteLength < 0 ||
      !Number.isSafeInteger(source.position) ||
      source.position < 0 ||
      !Number.isSafeInteger(source.position + source.byteLength)
    )
      throw new RangeError("Invalid font program source");
  }
  range(start = 0, end = this.source.byteLength): FontProgramRange {
    start = index(start, this.source.byteLength);
    end = index(end, this.source.byteLength);
    return new FontProgramRange(this, start, Math.max(0, end - start));
  }
  private async page(position: number): Promise<Page> {
    if (++this.requests % 4096 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(position) || position < 0 || position >= this.source.byteLength)
      throw new RangeError("Invalid font program offset");
    const start = Math.floor(position / 4096) * 4096;
    let page = this.pages.get(start);
    if (page) {
      this.pages.delete(start);
      this.pages.set(start, page);
      return page;
    }
    if (this.pages.size === 2) {
      const oldest = this.pages.values().next().value!;
      await this.save(oldest);
      this.pages.delete(oldest.start);
    }
    const length = Math.min(4096, this.source.byteLength - start);
    const bytes = await this.source.storage.read(
      this.source.position + start,
      length,
      this.options.signal ? { signal: this.options.signal } : undefined
    );
    this.options.signal?.throwIfAborted();
    if (bytes.length !== length) throw new PdfError("E_PARSE", "Incomplete font program range");
    page = { start, bytes: bytes.slice(), dirty: false };
    this.pages.set(start, page);
    return page;
  }
  private async save(page: Page): Promise<void> {
    if (!page.dirty) return;
    this.options.signal?.throwIfAborted();
    await this.source.storage.write(
      this.source.position + page.start,
      page.bytes,
      this.options.signal ? { signal: this.options.signal } : undefined
    );
    this.options.signal?.throwIfAborted();
    page.dirty = false;
  }
  async flush(): Promise<void> {
    for (const page of this.pages.values()) await this.save(page);
  }
  async byte(position: number): Promise<number> {
    const page = await this.page(position);
    return page.bytes[position - page.start]!;
  }
  async writeByte(position: number, value: number): Promise<void> {
    const page = await this.page(position);
    page.bytes[position - page.start] = value;
    page.dirty = true;
  }
  async read(position: number, length: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(length) ||
      !Number.isSafeInteger(position) ||
      length > 4096 ||
      length < 0 ||
      position < 0 ||
      position + length > this.source.byteLength
    )
      throw new RangeError("Invalid font program read");
    const bytes = new Uint8Array(length);
    for (let at = 0; at < length; ) {
      const page = await this.page(position + at),
        offset = position + at - page.start,
        count = Math.min(length - at, page.bytes.length - offset);
      bytes.set(page.bytes.subarray(offset, offset + count), at);
      at += count;
    }
    return bytes;
  }
  async write(position: number, bytes: Uint8Array): Promise<void> {
    if (
      !Number.isSafeInteger(position) ||
      bytes.length > 4096 ||
      position < 0 ||
      position + bytes.length > this.source.byteLength
    )
      throw new RangeError("Invalid font program write");
    for (let at = 0; at < bytes.length; ) {
      const page = await this.page(position + at),
        offset = position + at - page.start,
        count = Math.min(bytes.length - at, page.bytes.length - offset);
      page.bytes.set(bytes.subarray(at, at + count), offset);
      page.dirty = true;
      at += count;
    }
  }
}

export class FontProgramRange {
  constructor(
    private readonly program: FontProgramStore,
    readonly start: number,
    readonly length: number
  ) {}
  subarray(start = 0, end = this.length): FontProgramRange {
    start = index(start, this.length);
    end = index(end, this.length);
    return new FontProgramRange(this.program, this.start + start, Math.max(0, end - start));
  }
  async byte(at: number): Promise<number | undefined> {
    if (!Number.isInteger(at) || at < 0 || at >= this.length) return undefined;
    return this.program.byte(this.start + at);
  }
  async int(at: number, bytes: 2 | 4): Promise<number> {
    if (!Number.isInteger(at) || at < 0 || at + bytes > this.length)
      throw new RangeError("Offset is outside the bounds of the DataView");
    const data = await this.program.read(this.start + at, bytes),
      view = new DataView(data.buffer);
    return bytes === 2 ? view.getInt16(0) : view.getInt32(0);
  }
  /** PDF.js parser DataViews extend to the containing program; the outline
   * interpreter's DataViews instead stop at the charstring boundary. */
  async parserInt(at: number, bytes: 2 | 4): Promise<number> {
    if (!Number.isInteger(at) || at < 0 || this.start + at + bytes > this.program.source.byteLength)
      throw new RangeError("Offset is outside the bounds of the DataView");
    const data = await this.program.read(this.start + at, bytes),
      view = new DataView(data.buffer);
    return bytes === 2 ? view.getInt16(0) : view.getInt32(0);
  }
  async writeByte(at: number, value: number): Promise<void> {
    if (Number.isInteger(at) && at >= 0 && at < this.length)
      await this.program.writeByte(this.start + at, value);
  }
  async copyWithin(target: number, start: number, end = this.length): Promise<void> {
    target = index(target, this.length);
    start = index(start, this.length);
    end = index(end, this.length);
    const count = Math.min(Math.max(0, end - start), this.length - target),
      backward = start < target && target < start + count;
    for (let done = 0; done < count; ) {
      const length = Math.min(4096, count - done),
        offset = backward ? count - done - length : done;
      const bytes = await this.program.read(this.start + start + offset, length);
      await this.program.write(this.start + target + offset, bytes);
      done += length;
    }
  }
  async fill(value: number, start = 0, end = this.length): Promise<void> {
    start = index(start, this.length);
    end = index(end, this.length);
    const bytes = new Uint8Array(Math.min(4096, Math.max(0, end - start))).fill(value);
    for (let at = start; at < end; at += bytes.length)
      await this.program.write(
        this.start + at,
        bytes.subarray(0, Math.min(bytes.length, end - at))
      );
  }
}
