import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import type { LengthHintContext } from "./length-hint.js";

export interface SequenceIterationContext<Value> {
  getItem(sequence: Value, index: bigint): Value;
  isStopIteration(error: unknown): boolean;
  isIndexError(error: unknown): boolean;
}

/** Legacy indexed traversal after sequence-slot eligibility has been checked.
 * Successful reads advance; other errors retry the same index. IndexError and
 * StopIteration release the source permanently. No length lookup or close. */
export class SequenceIterator<Value> implements IterableIterator<Value> {
  #source: { value: Value } | undefined;
  #index = 0n;
  constructor(value: Value, private readonly context: SequenceIterationContext<Value>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64); this.#source = { value };
  }
  [Symbol.iterator](): IterableIterator<Value> { return this; }
  /** The sequence cursor's hint reads only its source's length, never the
   * source's own __length_hint__. Exhausted cursors release that source. */
  lengthHint(context: LengthHintContext<Value>, fallback = 0n): bigint {
    this.meter.checkpoint();
    if (this.#source === undefined) return 0n;
    let length: bigint | undefined;
    try { length = context.length(this.#source.value); }
    catch (error) {
      this.meter.checkpoint();
      const ignored = context.isTypeError(error); this.meter.checkpoint();
      if (!ignored) throw error;
    }
    this.meter.checkpoint();
    if (length === undefined) return fallback;
    if (length < 0n) throw new PythonRuntimeError("ValueError", "__len__() should return >= 0");
    if (BigInt.asIntN(64, length) !== length) throw new PythonRuntimeError("OverflowError", "cannot fit 'int' into an index-sized integer");
    return length > this.#index ? length - this.#index : 0n;
  }
  next(): IteratorResult<Value> {
    this.meter.checkpoint(1, 16);
    const source = this.#source;
    if (source === undefined) return { done: true, value: undefined };
    if (this.#index === (1n << 63n) - 1n) throw new PythonRuntimeError("OverflowError", "iter index too large");
    let value: Value;
    try { value = this.context.getItem(source.value, this.#index); }
    catch (error) {
      this.meter.checkpoint();
      let ended = this.context.isStopIteration(error);
      this.meter.checkpoint();
      if (!ended) { ended = this.context.isIndexError(error); this.meter.checkpoint(); }
      if (!ended) throw error;
      this.#source = undefined;
      return { done: true, value: undefined };
    }
    this.meter.checkpoint(); this.#index++;
    return { done: false, value };
  }
}
