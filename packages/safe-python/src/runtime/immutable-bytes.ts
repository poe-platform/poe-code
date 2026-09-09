import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { normalizeSlice } from "./integer-sequence.js";
import { searchSubstring, type SearchMode } from "./substring-search.js";

export type BytesCaseTransformation = "upper" | "lower" | "title" | "capitalize" | "swapcase";

/** Internal immutable bytes payload, not a guest object or releasable memoryview.
 * Public input/output buffers are copied. Internally created slices transfer sole
 * buffer ownership without a second copy. Buffer allocation and operations are
 * metered; host object/iterator overhead accounting remains unfinished. The host
 * iterator exposes only byte numbers; guest iterator adapters must meter next().
 */
export class ImmutableBytes implements Iterable<number> {
  readonly #bytes: Uint8Array;
  readonly length: number;

  private constructor(owned: Uint8Array) {
    this.#bytes = owned;
    this.length = owned.length;
    Object.freeze(this);
  }

  static copyOf(input: Uint8Array, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint(1, input.byteLength);
    const owned = new Uint8Array(input.length);
    for (let index = 0; index < input.length; index++) { meter.checkpoint(); owned[index] = input[index]; }
    return new ImmutableBytes(owned);
  }

  *[Symbol.iterator](): IterableIterator<number> {
    for (let index = 0; index < this.length; index++) yield this.#bytes[index];
  }

  toUint8Array(meter: ExecutionMeter): Uint8Array {
    meter.checkpoint(1, this.length);
    const output = new Uint8Array(this.length);
    for (let index = 0; index < this.length; index++) { meter.checkpoint(); output[index] = this.#bytes[index]; }
    return output;
  }

  byteAt(index: bigint, meter: ExecutionMeter): number {
    meter.checkpoint();
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    if (index < 0n) index += BigInt(this.length);
    if (index < 0n || index >= BigInt(this.length)) throw new PythonRuntimeError("IndexError", "index out of range");
    return this.#bytes[Number(index)];
  }

  slice(start: bigint | null, stop: bigint | null, step: bigint | null, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    const indices = normalizeSlice(BigInt(this.length), start, stop, step);
    const count = Number(indices.length);
    meter.checkpoint(0, count);
    const owned = new Uint8Array(count);
    const stride = count > 1 ? Number(indices.step) : 0;
    for (let offset = 0, index = Number(indices.start); offset < count; offset++, index += stride) {
      meter.checkpoint(); owned[offset] = this.#bytes[index];
    }
    return new ImmutableBytes(owned);
  }

  repeat(count: number, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("repeat requires a nonnegative safe integer");
    if (this.length === 0 || count === 1) return this;
    const length = this.length * count;
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) { meter.checkpoint(); bytes[i] = this.#bytes[i % this.length]; }
    return new ImmutableBytes(bytes);
  }

  /** Bytes casing is ASCII-only and never expands its input. Non-ASCII bytes
   * are preserved and break title words, regardless of the host locale. */
  transformCase(mode: BytesCaseTransformation, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (this.length === 0) return this;
    meter.checkpoint(0, this.length);
    const bytes = new Uint8Array(this.length);
    let previousCased = false;
    for (let index = 0; index < this.length; index++) {
      meter.checkpoint();
      const byte = this.#bytes[index], upper = byte >= 65 && byte <= 90, lower = byte >= 97 && byte <= 122;
      const toUpper = mode === "upper" || mode === "swapcase" && lower || mode === "title" && !previousCased || mode === "capitalize" && index === 0;
      const toLower = mode === "lower" || mode === "swapcase" && upper || mode === "title" && previousCased || mode === "capitalize" && index !== 0;
      bytes[index] = toUpper && lower ? byte - 32 : toLower && upper ? byte + 32 : byte;
      previousCased = upper || lower;
    }
    return new ImmutableBytes(bytes);
  }

  concat(other: ImmutableBytes, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (this.length === 0) return other;
    if (other.length === 0) return this;
    meter.checkpoint(0, this.length + other.length);
    const bytes = new Uint8Array(this.length + other.length);
    for (let i = 0; i < this.length; i++) { meter.checkpoint(); bytes[i] = this.#bytes[i]; }
    for (let i = 0; i < other.length; i++) { meter.checkpoint(); bytes[this.length + i] = other.#bytes[i]; }
    return new ImmutableBytes(bytes);
  }

  /** Bounded searches retain original byte positions, including empty-pattern
   * boundaries. Integer needles use an allocation-free scan. */
  search(needle: ImmutableBytes | number, mode: SearchMode, start = 0n, stop: bigint | null = null, meter: ExecutionMeter): number {
    meter.checkpoint();
    if (typeof needle === "number" && (!Number.isInteger(needle) || needle < 0 || needle > 255)) throw new RangeError("byte search requires an integer in range 0..255");
    const length = BigInt(this.length), needleLength = typeof needle === "number" ? 1 : needle.length;
    if (start < 0n) start += length;
    if (start < 0n) start = 0n;
    stop ??= length;
    if (stop < 0n) stop += length;
    if (stop < 0n) stop = 0n;
    if (stop > length) stop = length;
    if (start > stop || BigInt(needleLength) > stop - start) return mode === "count" ? 0 : -1;
    if (needleLength === 0) return Number(mode === "find" ? start : mode === "rfind" ? stop : stop - start + 1n);
    if (typeof needle !== "number") return searchSubstring(this.#bytes, needle.#bytes, Number(start), Number(stop), mode, meter);
    let result = mode === "count" ? 0 : -1;
    for (let index = Number(start); index < Number(stop); index++) {
      meter.checkpoint();
      if (this.#bytes[index] !== needle) continue;
      if (mode === "find") return index;
      if (mode === "count") result++; else result = index;
    }
    return result;
  }

  /** Search owned storage without exporting/copying either buffer. */
  contains(needle: ImmutableBytes | number, meter: ExecutionMeter): boolean {
    meter.checkpoint();
    if (typeof needle === "number") {
      if (!Number.isInteger(needle) || needle < 0 || needle > 255) throw new RangeError("byte search requires an integer in range 0..255");
      for (let index = 0; index < this.length; index++) { meter.checkpoint(); if (this.#bytes[index] === needle) return true; }
      return false;
    }
    if (needle.length === 0) return true;
    if (needle.length > this.length) return false;
    return searchSubstring(this.#bytes, needle.#bytes, 0, this.length, "find", meter) !== -1;
  }

  compare(other: ImmutableBytes, meter: ExecutionMeter): -1 | 0 | 1 {
    meter.checkpoint();
    const common = Math.min(this.length, other.length);
    for (let index = 0; index < common; index++) {
      meter.checkpoint();
      if (this.#bytes[index] !== other.#bytes[index]) return this.#bytes[index] < other.#bytes[index] ? -1 : 1;
    }
    return this.length === other.length ? 0 : this.length < other.length ? -1 : 1;
  }
}
