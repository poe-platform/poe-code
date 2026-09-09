import { PythonRuntimeError } from "./error.js";
import { normalizeSlice } from "./integer-sequence.js";
import { searchSubstring, type SearchMode } from "./substring-search.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Internal immutable string storage, not the guest str object/protocol itself.
 * Surrogates remain individual code points; no UTF-16 round trip is performed.
 */
export class CodePointString implements Iterable<number> {
  readonly #points: Uint32Array;
  readonly length: number;

  constructor(points: Uint32Array) {
    this.#points = new Uint32Array(points);
    for (const point of this.#points) {
      if (point > 0x10ffff) throw new PythonRuntimeError("ValueError", "string code point outside Unicode range");
    }
    this.length = this.#points.length;
    Object.freeze(this);
  }

  *[Symbol.iterator](): IterableIterator<number> {
    for (let index = 0; index < this.length; index++) yield this.#points[index]!;
  }

  codePointAt(index: bigint): number {
    // String indexing uses the guest's signed 64-bit index model, unlike range.
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    if (index < 0n) index += BigInt(this.length);
    if (index < 0n || index >= BigInt(this.length)) throw new PythonRuntimeError("IndexError", "string index out of range");
    return this.#points[Number(index)]!;
  }

  slice(start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null): CodePointString {
    const indices = normalizeSlice(BigInt(this.length), start, stop, step);
    if (indices.step === 1n) {
      if (indices.start === 0n && indices.stop === BigInt(this.length)) return this;
      return new CodePointString(this.#points.subarray(Number(indices.start), Number(indices.stop)));
    }
    const count = Number(indices.length);
    const points = new Uint32Array(count);
    // With at least two elements, the stride is bounded by the stored length.
    // Otherwise an arbitrary-size step need never be converted to a JS number.
    const stride = count > 1 ? Number(indices.step) : 0;
    for (let offset = 0, index = Number(indices.start); offset < count; offset++, index += stride) points[offset] = this.#points[index]!;
    return new CodePointString(points);
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

  compare(other: CodePointString): -1 | 0 | 1 {
    const common = Math.min(this.length, other.length);
    for (let index = 0; index < common; index++) {
      if (this.#points[index]! < other.#points[index]!) return -1;
      if (this.#points[index]! > other.#points[index]!) return 1;
    }
    return this.length < other.length ? -1 : this.length > other.length ? 1 : 0;
  }
}
