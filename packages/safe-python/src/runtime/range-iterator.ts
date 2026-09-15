import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerProgression } from "./integer-sequence.js";

/** Constant-slot forward/reverse cursor over a validated integer progression.
 * Length hints are exact bigint values, including values that overflow the
 * separate operator.length_hint machine-width conversion. Guest int/iterator
 * wrapping, state restoration/pickling and bigint payload/CPU accounting remain
 * external. No sequence is materialized or retained by this cursor.
 */
export class RangeIterator implements IterableIterator<bigint> {
  #remaining: bigint;
  #next: bigint;
  readonly #step: bigint;

  constructor(range: IntegerProgression, reverse: boolean, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    const { start, step, length } = range;
    this.#remaining = length;
    this.#next = reverse && length !== 0n ? start + (length - 1n) * step : start;
    this.#step = reverse ? -step : step;
  }

  [Symbol.iterator](): IterableIterator<bigint> { return this; }

  lengthHint(): bigint {
    this.meter.checkpoint();
    return this.#remaining;
  }

  next(): IteratorResult<bigint> {
    this.meter.checkpoint(1, 16);
    if (this.#remaining === 0n) return { done: true, value: undefined };
    const value = this.#next;
    this.#next += this.#step;
    this.#remaining--;
    return { done: false, value };
  }
}
