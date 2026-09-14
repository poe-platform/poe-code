import type { ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import type { RangeValue, RuntimeValue } from "./runtime-values.js";

type Integer = RangeValue["start"];

/** CPython's two range cursor layouts on the pinned LP64 platform. The fast
 * layout is chosen from the original bounds, including the conservative
 * overflow checks; it is not chosen just from the values eventually yielded.
 * A state update advances the remaining progression, never rewinds it. */
export class RuntimeRangeIterator implements IterableIterator<RuntimeValue> {
  readonly typeName: "range_iterator" | "longrange_iterator";
  #start: Integer;
  readonly #step: Integer;
  #length: Integer;

  constructor(range: RangeValue, reverse: boolean, private readonly values: ConstantValues, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 96);
    const { start, stop, step, length } = range.value;
    const minimum = -(1n << 63n), maximum = (1n << 63n) - 1n;
    let fast = start >= minimum && start <= maximum && stop >= minimum && stop <= maximum
      && step >= minimum && step <= maximum && length <= maximum;
    if (reverse) fast &&= step !== minimum && start - step >= minimum && start - step <= maximum;
    else if (length !== 0n) fast &&= step > 0n ? stop <= maximum - (step - 1n) : stop >= minimum + (-1n - step);
    this.typeName = fast ? "range_iterator" : "longrange_iterator";
    this.#start = reverse ? values.integer(start + (length - 1n) * step) : range.start;
    this.#step = reverse ? values.integer(-step) : range.step;
    this.#length = values.integer(length);
  }

  [Symbol.iterator](): IterableIterator<RuntimeValue> { return this; }

  lengthHint(): bigint {
    this.meter.checkpoint();
    return this.#length.value;
  }

  hintValue(): Integer {
    this.meter.checkpoint();
    return this.typeName === "longrange_iterator" ? this.#length : this.values.integer(this.#length.value);
  }

  next(): IteratorResult<RuntimeValue> {
    this.meter.checkpoint(1, 16);
    if (this.#length.value === 0n) return { done: true, value: undefined };
    const result = this.typeName === "longrange_iterator" ? this.#start : this.values.integer(this.#start.value);
    this.advance(1n);
    return { done: false, value: result };
  }

  advance(index: bigint): void {
    this.meter.checkpoint();
    index = index < 0n ? 0n : index > this.#length.value ? this.#length.value : index;
    const start = this.values.integer(this.#start.value + index * this.#step.value);
    const length = this.values.integer(this.#length.value - index);
    this.#start = start;
    this.#length = length;
  }

  /** Snapshot before builtin lookup: a reentrant lookup may advance this cursor
   * but must not change the range already constructed for reduction. */
  reductionRange(): RangeValue {
    const start = this.typeName === "longrange_iterator" ? this.#start : this.values.integer(this.#start.value);
    const step = this.typeName === "longrange_iterator" ? this.#step : this.values.integer(this.#step.value);
    const stop = this.values.integer(start.value + this.#length.value * step.value);
    this.meter.checkpoint(1, 96);
    return Object.freeze({ kind: "range", value: createRange(start.value, stop.value, step.value), start, stop, step });
  }
}
