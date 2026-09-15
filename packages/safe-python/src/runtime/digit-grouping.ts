import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";

/** Immutable POSIX grouping pattern, measured from the right. Zero repeats the
 * previous size; 127 stops; array exhaustion acts like a C-string zero terminator.
 * Locale acquisition/CHAR_MAX normalization and separators belong to the owner.
 * Prefix sums plus an optional repeating tail avoid scanning padded widths. */
export class DigitGrouping {
  readonly #ends: readonly number[];
  readonly #repeat: number;

  constructor(groups: readonly number[], meter: ExecutionMeter) {
    meter.checkpoint(1, 128);
    const ends: number[] = [];
    let span = 0, repeat = 0;
    for (const size of groups) {
      meter.checkpoint();
      if (!Number.isInteger(size) || size < 0 || size > 127) throw new RangeError("grouping size must be a byte from 0 through 127");
      if (size === 0) break;
      if (size === 127) { repeat = 0; break; }
      span += size;
      if (!Number.isSafeInteger(span)) throw new RangeError("grouping span is too large");
      meter.checkpoint(0, 8); ends.push(span); repeat = size;
    }
    this.#ends = Object.freeze(ends); this.#repeat = repeat;
    Object.freeze(this);
  }

  separatorCount(digits: number, meter: ExecutionMeter): number {
    meter.checkpoint(); dimension(digits);
    const span = this.#ends.at(-1) ?? 0;
    if (this.#repeat !== 0 && digits > span) return this.#ends.length + Math.floor((digits - 1 - span) / this.#repeat);
    let low = 0, high = this.#ends.length;
    while (low < high) {
      meter.checkpoint();
      const middle = Math.floor((low + high) / 2);
      if (this.#ends[middle] < digits) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** Whether a separator belongs immediately before this many remaining digits. */
  isBoundary(remaining: number, meter: ExecutionMeter): boolean {
    meter.checkpoint(); dimension(remaining);
    if (remaining === 0) return false;
    const span = this.#ends.at(-1) ?? 0;
    if (remaining > span) return this.#repeat !== 0 && (remaining - span) % this.#repeat === 0;
    let low = 0, high = this.#ends.length;
    while (low < high) {
      meter.checkpoint();
      const middle = Math.floor((low + high) / 2), end = this.#ends[middle];
      if (end === remaining) return true;
      if (end < remaining) low = middle + 1;
      else high = middle;
    }
    return false;
  }

  /** Minimum digit count whose grouped length meets width, never dropping input.
   * Final output-size validation still belongs to the buffer allocator. */
  minimumDigits(width: bigint, initial: number, separatorWidth: number, meter: ExecutionMeter): number {
    meter.checkpoint(); dimension(initial); dimension(separatorWidth);
    if (width < 0n) throw new RangeError("grouped width must be nonnegative");
    if (width > 0xffffffffn) exhaustAllocation(meter);
    let low = initial, high = Math.max(initial, Number(width));
    while (low < high) {
      meter.checkpoint(1, 64);
      const middle = low + Math.floor((high - low) / 2);
      const length = BigInt(middle) + BigInt(this.separatorCount(middle, meter)) * BigInt(separatorWidth);
      if (length < width) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

function dimension(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError("grouping dimension must be a nonnegative 32-bit length");
}
