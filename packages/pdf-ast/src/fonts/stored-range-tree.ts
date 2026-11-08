import type { PdfPixelStorage } from "../ast.js";

/** A fixed-depth range tree. Zero is absent; stored addresses are biased by one. */
export class StoredNumberRangeTree {
  root = 0;
  constructor(
    readonly storage: PdfPixelStorage,
    readonly signal?: AbortSignal
  ) {}
  async node(pointer: number): Promise<number[]> {
    this.signal?.throwIfAborted();
    if (!pointer) return [0, 0, 0];
    const bytes = await this.storage.read(
      pointer - 1,
      24,
      this.signal ? { signal: this.signal } : undefined
    );
    this.signal?.throwIfAborted();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getFloat64(0), view.getFloat64(8), view.getFloat64(16)];
  }
  async write(pointer: number, values: readonly number[]): Promise<number> {
    this.signal?.throwIfAborted();
    if (!pointer) pointer = this.storage.allocate(24) + 1;
    const bytes = new Uint8Array(24),
      view = new DataView(bytes.buffer);
    values.forEach((v, i) => view.setFloat64(i * 8, v));
    await this.storage.write(pointer - 1, bytes, this.signal ? { signal: this.signal } : undefined);
    this.signal?.throwIfAborted();
    return pointer;
  }
  async assign(low: number, high: number, value: number): Promise<void> {
    if (low > high) return;
    const update = async (pointer: number, start: number, end: number): Promise<number> => {
      if (low <= start && high >= end) return this.write(pointer, [0, 0, value]);
      const node = await this.node(pointer);
      let [left, right] = node;
      const uniform = node[2];
      const middle = Math.floor((start + end) / 2);
      if (!left && !right && uniform) {
        left = await this.write(0, [0, 0, uniform!]);
        right = await this.write(0, [0, 0, uniform!]);
      }
      if (low <= middle) left = await update(left!, start, middle);
      if (high > middle) right = await update(right!, middle + 1, end);
      return this.write(pointer, [left!, right!, 0]);
    };
    this.root = await update(this.root, 0, 0xffffffff);
  }
  async lookup(code: number): Promise<number> {
    let pointer = this.root,
      start = 0,
      end = 0xffffffff;
    while (pointer) {
      const [left, right, value] = await this.node(pointer);
      if (!left && !right) return value!;
      const middle = Math.floor((start + end) / 2);
      if (code <= middle) {
        pointer = left!;
        end = middle;
      } else {
        pointer = right!;
        start = middle + 1;
      }
    }
    return 0;
  }
  async *leaves(
    pointer = this.root,
    low = 0,
    high = 0xffffffff
  ): AsyncGenerator<{ value: number; low: number; high: number }> {
    if (!pointer) return;
    const [left, right, value] = await this.node(pointer);
    if (!left && !right) {
      if (value) yield { value, low, high };
      return;
    }
    const middle = Math.floor((low + high) / 2);
    yield* this.leaves(left, low, middle);
    yield* this.leaves(right, middle + 1, high);
  }
}
