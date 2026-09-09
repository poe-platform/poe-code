import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

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
