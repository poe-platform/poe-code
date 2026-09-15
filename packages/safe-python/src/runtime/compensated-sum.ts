import type { ExecutionMeter } from "./execution-budget.js";

/** Neumaier compensated binary64 accumulation, matching Python 3.14 sum's
 * float-component kernel. This is not an exact sum or math.fsum: intermediate
 * overflow remains overflow. Fixed scalar storage avoids per-item allocation. */
export class CompensatedSum {
  #high: number;
  #low = 0;

  constructor(start: number, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 48);
    this.#high = start;
  }

  add(value: number): void {
    this.meter.checkpoint();
    const total = this.#high + value;
    this.#low += Math.abs(this.#high) >= Math.abs(value)
      ? (this.#high - total) + value
      : (value - total) + this.#high;
    this.#high = total;
  }

  /** Reading does not flush compensation or alter subsequent additions.
   * Skip zero to retain signed zero, and nonfinite compensation to avoid
   * introducing NaN solely from an infinite/overflowed high component. */
  toNumber(): number {
    this.meter.checkpoint();
    return this.#low !== 0 && Number.isFinite(this.#low) ? this.#high + this.#low : this.#high;
  }
}
