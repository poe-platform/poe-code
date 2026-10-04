import type { PdfPixelStorage } from "../ast.js";

const PAGE_BYTES = 4096,
  VALUES = (PAGE_BYTES - 16) / 8;
interface Page {
  position: number;
  bytes: Uint8Array;
  view: DataView;
}

/** Two cached ends of a caller-backed deque. Interior pages carry their own
 * previous/next links; no resident page index grows with operand count. */
export class StoredFontOperands {
  private first: Page | undefined;
  private last: Page | undefined;
  private start = 0;
  private end = 0;
  private count = 0;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {}
  get length(): number {
    return this.count;
  }
  set length(value: number) {
    this.signal?.throwIfAborted();
    if (value !== 0) throw new RangeError("Font operands can only be cleared");
    this.count = 0;
    this.start = this.end = 0;
    this.first = this.last;
    if (this.last) {
      this.last.view.setFloat64(0, -1, true);
      this.last.view.setFloat64(8, -1, true);
    }
  }
  private allocate(previous = -1): Page {
    const position = this.storage.allocate(PAGE_BYTES);
    if (
      !Number.isSafeInteger(position) ||
      position < 0 ||
      !Number.isSafeInteger(position + PAGE_BYTES)
    )
      throw new RangeError("Invalid font operand allocation");
    const bytes = new Uint8Array(PAGE_BYTES),
      view = new DataView(bytes.buffer);
    view.setFloat64(0, previous, true);
    view.setFloat64(8, -1, true);
    return { position, bytes, view };
  }
  private async read(position: number): Promise<Page> {
    if (position === this.first?.position) return this.first;
    if (position === this.last?.position) return this.last;
    if (!Number.isSafeInteger(position) || position < 0)
      throw new RangeError("Invalid font operand page");
    const response = await this.storage.read(
      position,
      PAGE_BYTES,
      this.signal ? { signal: this.signal } : undefined
    );
    this.signal?.throwIfAborted();
    if (response.length !== PAGE_BYTES) throw new Error("Incomplete font operand page");
    const bytes = response.slice();
    return { position, bytes, view: new DataView(bytes.buffer) };
  }
  async push(value: number): Promise<void> {
    this.signal?.throwIfAborted();
    if (!this.count) {
      this.length = 0;
      this.first = this.last ??= this.allocate();
    }
    if (this.end === VALUES) {
      const next = this.allocate(this.last!.position);
      this.last!.view.setFloat64(8, next.position, true);
      await this.storage.write(
        this.last!.position,
        this.last!.bytes,
        this.signal ? { signal: this.signal } : undefined
      );
      this.signal?.throwIfAborted();
      this.last = next;
      this.end = 0;
    }
    this.last!.view.setFloat64(16 + this.end++ * 8, value, true);
    this.count++;
  }
  async pop(): Promise<number | undefined> {
    this.signal?.throwIfAborted();
    if (!this.count) return undefined;
    if (!this.end) {
      this.last = await this.read(this.last!.view.getFloat64(0, true));
      this.end = VALUES;
      this.last.view.setFloat64(8, -1, true);
    }
    this.count--;
    return this.last!.view.getFloat64(16 + --this.end * 8, true);
  }
  async shift(): Promise<number | undefined> {
    this.signal?.throwIfAborted();
    if (!this.count) return undefined;
    if (this.start === VALUES) {
      this.first = await this.read(this.first!.view.getFloat64(8, true));
      this.start = 0;
    }
    this.count--;
    return this.first!.view.getFloat64(16 + this.start++ * 8, true);
  }
}
