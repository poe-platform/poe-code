import { PythonRuntimeError } from "./error.js";
import { normalizeSlice } from "./integer-sequence.js";
import { searchSubstring, type SearchMode } from "./substring-search.js";
import type { ExecutionMeter } from "./execution-budget.js";

// Module-private capability: only freshly generated, already charged buffers
// may bypass public input copying and validation. Never export this marker.
const ownedPoints = Symbol("owned code points");

/** Internal immutable string storage, not the guest str object/protocol itself.
 * Surrogates remain individual code points; no UTF-16 round trip is performed.
 */
export class CodePointString implements Iterable<number> {
  readonly #points: Uint32Array;
  readonly length: number;

  constructor(points: Uint32Array, meter?: ExecutionMeter, ownership?: typeof ownedPoints) {
    const adopt = ownership === ownedPoints;
    meter?.checkpoint(1, adopt ? 0 : points.byteLength);
    this.#points = adopt ? points : new Uint32Array(points.length);
    if (!adopt) {
      for (let index = 0; index < this.#points.length; index++) {
        meter?.checkpoint();
        const point = points[index]!;
        if (point > 0x10ffff) throw new PythonRuntimeError("ValueError", "string code point outside Unicode range");
        this.#points[index] = point;
      }
    }
    this.length = this.#points.length;
    Object.freeze(this);
  }

  *[Symbol.iterator](): IterableIterator<number> {
    for (let index = 0; index < this.length; index++) yield this.#points[index]!;
  }

  codePointAt(index: bigint, meter?: ExecutionMeter): number {
    meter?.checkpoint();
    // String indexing uses the guest's signed 64-bit index model, unlike range.
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    if (index < 0n) index += BigInt(this.length);
    if (index < 0n || index >= BigInt(this.length)) throw new PythonRuntimeError("IndexError", "string index out of range");
    return this.#points[Number(index)]!;
  }

  slice(start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null, meter?: ExecutionMeter): CodePointString {
    meter?.checkpoint();
    const indices = normalizeSlice(BigInt(this.length), start, stop, step);
    if (indices.step === 1n) {
      if (indices.start === 0n && indices.stop === BigInt(this.length)) return this;
      return new CodePointString(this.#points.subarray(Number(indices.start), Number(indices.stop)), meter);
    }
    const count = Number(indices.length);
    meter?.checkpoint(0, count * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(count);
    // With at least two elements, the stride is bounded by the stored length.
    // Otherwise an arbitrary-size step need never be converted to a JS number.
    const stride = count > 1 ? Number(indices.step) : 0;
    for (let offset = 0, index = Number(indices.start); offset < count; offset++, index += stride) {
      meter?.checkpoint();
      points[offset] = this.#points[index]!;
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  repeat(count: number, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("repeat requires a nonnegative safe integer");
    if (this.length === 0 || count === 1) return this;
    const length = this.length * count;
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    for (let i = 0; i < length; i++) { meter.checkpoint(); points[i] = this.#points[i % this.length]; }
    return new CodePointString(points, meter, ownedPoints);
  }

  concat(other: CodePointString, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (this.length === 0) return other;
    if (other.length === 0) return this;
    meter.checkpoint(0, (this.length + other.length) * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(this.length + other.length);
    for (let i = 0; i < this.length; i++) { meter.checkpoint(); points[i] = this.#points[i]; }
    for (let i = 0; i < other.length; i++) { meter.checkpoint(); points[this.length + i] = other.#points[i]; }
    return new CodePointString(points, meter, ownedPoints);
  }

  search(needle: CodePointString, mode: SearchMode, start = 0n, stop: bigint | null = null, meter?: ExecutionMeter): number {
    meter?.checkpoint();
    const length = BigInt(this.length);
    if (start < 0n) start += length;
    if (start < 0n) start = 0n;
    stop ??= length;
    if (stop < 0n) stop += length;
    if (stop < 0n) stop = 0n;
    if (stop > length) stop = length;
    // Unlike slice normalization, start beyond the end cannot match even ''.
    if (start > stop || BigInt(needle.length) > stop - start) return mode === "count" ? 0 : -1;
    if (needle.length === 0) return Number(mode === "find" ? start : mode === "rfind" ? stop : stop - start + 1n);
    return searchSubstring(this.#points, needle.#points, Number(start), Number(stop), mode, meter);
  }

  compare(other: CodePointString, meter?: ExecutionMeter): -1 | 0 | 1 {
    meter?.checkpoint();
    const common = Math.min(this.length, other.length);
    for (let index = 0; index < common; index++) {
      meter?.checkpoint();
      if (this.#points[index]! < other.#points[index]!) return -1;
      if (this.#points[index]! > other.#points[index]!) return 1;
    }
    return this.length < other.length ? -1 : this.length > other.length ? 1 : 0;
  }
}
