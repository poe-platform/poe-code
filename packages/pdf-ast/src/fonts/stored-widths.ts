import { IntegerTable } from "@poe-code/safe-fs/storage";
import type { PdfPixelStorage } from "../ast.js";
import type { PdfFontAllocationOptions } from "./memory.js";

/** Width ranges retain declaration order in caller storage. Ordered ranges use
 * binary search; overlapping ranges retain the buffered last-match semantics. */
export class StoredFontWidths {
  readonly storedWidths = true;
  private readonly index: IntegerTable;
  private readonly cache = new Map<number, number | undefined>();
  private defaults: Readonly<Record<number, number>> | undefined;
  private count = 0;
  private ordered = true;
  private lastEnd = -Infinity;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly options: Pick<PdfFontAllocationOptions, "onAllocation"> & {
      signal?: AbortSignal;
    } = {}
  ) {
    options.signal?.throwIfAborted();
    options.onAllocation?.(65536);
    const signal = options.signal;
    const pending: Array<{ at: number; length: number }> = [];
    async function initialize() {
      // IntegerTable reserves one node before its next I/O. The capability need
      // not initialize reserved ranges, so publish zeros before any node read.
      while (pending.length) {
        const { at, length } = pending.shift()!;
        signal?.throwIfAborted();
        await storage.write(at, new Uint8Array(length), signal ? { signal } : undefined);
        signal?.throwIfAborted();
      }
    }
    this.index = new IntegerTable(
      {
        allocate(n) {
          const at = storage.allocate(n);
          pending.push({ at, length: n });
          return at;
        },
        async read(at, n) {
          await initialize();
          signal?.throwIfAborted();
          const bytes = await storage.read(at, n, signal ? { signal } : undefined);
          signal?.throwIfAborted();
          return bytes.slice();
        },
        async write(at, bytes) {
          await initialize();
          signal?.throwIfAborted();
          await storage.write(at, bytes, signal ? { signal } : undefined);
          signal?.throwIfAborted();
        }
      },
      64
    );
  }
  /** Immutable bundled metrics remain shared; document declarations override them. */
  setDefaults(widths: Readonly<Record<number, number>>): void {
    this.options.signal?.throwIfAborted();
    this.defaults = widths;
    this.cache.clear();
  }
  async set(first: number, width: number, last = first): Promise<void> {
    const signal = this.options.signal;
    signal?.throwIfAborted();
    if (last < first) return;
    const at = this.storage.allocate(24),
      bytes = new Uint8Array(24),
      view = new DataView(bytes.buffer);
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(at + 24))
      throw new RangeError("Invalid font width allocation");
    view.setFloat64(0, first);
    view.setFloat64(8, last);
    view.setFloat64(16, width);
    await this.storage.write(at, bytes, signal ? { signal } : undefined);
    signal?.throwIfAborted();
    await this.index.set(BigInt(this.count), BigInt(at));
    signal?.throwIfAborted();
    if (this.count && first <= this.lastEnd) this.ordered = false;
    this.lastEnd = last;
    this.count++;
    this.cache.clear();
  }
  private async record(index: number): Promise<[number, number, number]> {
    const signal = this.options.signal;
    signal?.throwIfAborted();
    const at = await this.index.get(BigInt(index));
    signal?.throwIfAborted();
    if (at === undefined) throw new Error("Missing font width record");
    const bytes = await this.storage.read(Number(at), 24, signal ? { signal } : undefined);
    signal?.throwIfAborted();
    if (bytes.length !== 24) throw new Error("Incomplete font width record");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getFloat64(0), view.getFloat64(8), view.getFloat64(16)];
  }
  async get(code: number): Promise<number | undefined> {
    this.options.signal?.throwIfAborted();
    if (!Number.isFinite(code)) return undefined;
    if (this.cache.has(code)) return this.cache.get(code);
    let result: number | undefined;
    if (this.ordered) {
      let first = 0,
        last = this.count - 1;
      while (first <= last) {
        const middle = Math.floor((first + last) / 2),
          [low, high, width] = await this.record(middle);
        if (code < low) last = middle - 1;
        else if (code > high) first = middle + 1;
        else {
          result = Number.isInteger(code - low) ? width : undefined;
          break;
        }
      }
    } else {
      for (let i = this.count - 1; i >= 0; i--) {
        if (i % 256 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          this.options.signal?.throwIfAborted();
        }
        const [low, high, width] = await this.record(i);
        if (code >= low && code <= high && Number.isInteger(code - low)) {
          result = width;
          break;
        }
      }
    }
    if (this.cache.size === 64) this.cache.delete(this.cache.keys().next().value!);
    result ??= this.defaults?.[code];
    this.cache.set(code, result);
    return result;
  }
  async has(code: number): Promise<boolean> {
    return (await this.get(code)) !== undefined;
  }
}
