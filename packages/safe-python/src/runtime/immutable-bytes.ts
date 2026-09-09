import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { normalizeSlice } from "./integer-sequence.js";
import { searchSubstring, type SearchMode } from "./substring-search.js";
import { isAsciiWhitespace } from "./ascii-whitespace.js";

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

  /** Size first, then fill a single owned buffer. Only CR/LF reset columns. */
  expandTabs(tabsize: number, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (!Number.isSafeInteger(tabsize)) throw new RangeError("tab size must be a safe integer");
    if (this.length === 0) return this;
    let length = 0, column = 0;
    for (const byte of this.#bytes) {
      meter.checkpoint();
      if (byte === 9) {
        const spaces = tabsize > 0 ? tabsize - column % tabsize : 0;
        length += spaces; column += spaces;
      } else { length++; column = byte === 10 || byte === 13 ? 0 : column + 1; }
      if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    }
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0;
    column = 0;
    for (const byte of this.#bytes) {
      meter.checkpoint();
      if (byte === 9) {
        const spaces = tabsize > 0 ? tabsize - column % tabsize : 0, end = offset + spaces;
        while (offset < end) { meter.checkpoint(); bytes[offset++] = 32; }
        column += spaces;
      } else { bytes[offset++] = byte; column = byte === 10 || byte === 13 ? 0 : column + 1; }
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

  /** Index custom byte sets once, scan only the edges, and copy one final slice. */
  strip(side: "strip" | "lstrip" | "rstrip", chars: ImmutableBytes | null, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (this.length === 0 || chars?.length === 0) return this;
    let members: Uint8Array | undefined;
    if (chars !== null) {
      meter.checkpoint(1, 256); members = new Uint8Array(256);
      for (const byte of chars.#bytes) { meter.checkpoint(); members[byte] = 1; }
    }
    let start = 0, stop = this.length;
    if (side !== "rstrip") while (start < stop) {
      meter.checkpoint(); const byte = this.#bytes[start];
      if (members === undefined ? !isAsciiWhitespace(byte) : members[byte] === 0) break;
      start++;
    }
    if (side !== "lstrip") while (stop > start) {
      meter.checkpoint(); const byte = this.#bytes[stop - 1];
      if (members === undefined ? !isAsciiWhitespace(byte) : members[byte] === 0) break;
      stop--;
    }
    if (start === 0 && stop === this.length) return this;
    return this.slice(BigInt(start), BigInt(stop), null, meter);
  }

  /** Size all validated parts before allocating a single owned output buffer. */
  join(parts: readonly ImmutableBytes[], meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (parts.length === 1) return parts[0];
    let length = 0;
    for (let index = 0; index < parts.length; index++) {
      meter.checkpoint();
      length += parts[index].length + (index === 0 ? 0 : this.length);
      if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    }
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (let index = 0; index < parts.length; index++) {
      meter.checkpoint();
      if (index !== 0) for (const byte of this.#bytes) { meter.checkpoint(); bytes[offset++] = byte; }
      for (const byte of parts[index].#bytes) { meter.checkpoint(); bytes[offset++] = byte; }
    }
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

  /** Compare one normalized edge in place, never exporting or slicing storage. */
  hasAffix(affix: ImmutableBytes, side: "start" | "end", start = 0n, stop: bigint | null = null, meter: ExecutionMeter): boolean {
    meter.checkpoint();
    const length = BigInt(this.length);
    if (start < 0n) start += length;
    if (start < 0n) start = 0n;
    stop ??= length;
    if (stop < 0n) stop += length;
    if (stop < 0n) stop = 0n;
    if (stop > length) stop = length;
    if (start > stop || BigInt(affix.length) > stop - start) return false;
    if (affix.length === 0) return true;
    const offset = side === "start" ? Number(start) : Number(stop) - affix.length;
    meter.checkpoint();
    if (this.#bytes[offset] !== affix.#bytes[0] || this.#bytes[offset + affix.length - 1] !== affix.#bytes[affix.length - 1]) return false;
    for (let index = 1; index < affix.length - 1; index++) {
      meter.checkpoint();
      if (this.#bytes[offset + index] !== affix.#bytes[index]) return false;
    }
    return true;
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
