import type { ExecutionMeter } from "./execution-budget.js";

export interface FilterIterationContext<Value> {
  /** Pure identity check for guest None or the exact builtin bool object. */
  isTruthPredicate(predicate: Value): boolean;
  call(predicate: Value, value: Value): Value;
  truth(value: Value): boolean;
  /** Guest StopIteration/subclasses only, never fatal execution-limit signals. */
  isStopIteration(error: unknown): boolean;
}

/** Lazy filtering of an already prepared iterator. Guest argument binding,
 * eager iterable acquisition and object wrapping belong to the caller. A stop
 * from a source or callback ends this next call without latching exhaustion.
 */
export class FilterIterator<Value> implements IterableIterator<Value> {
  readonly #truthOnly: boolean;

  constructor(private readonly predicate: Value, private readonly source: Iterator<Value>, private readonly context: FilterIterationContext<Value>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#truthOnly = context.isTruthPredicate(predicate);
    meter.checkpoint();
  }

  [Symbol.iterator](): IterableIterator<Value> { return this; }

  next(): IteratorResult<Value> {
    this.meter.checkpoint(1, 16);
    try {
      while (true) {
        this.meter.checkpoint();
        const item = this.source.next();
        this.meter.checkpoint();
        if (item.done) return { done: true, value: undefined };
        let decision = item.value;
        if (!this.#truthOnly) {
          decision = this.context.call(this.predicate, item.value);
          this.meter.checkpoint();
        }
        const accepted = this.context.truth(decision);
        this.meter.checkpoint();
        if (accepted) return { done: false, value: item.value };
      }
    } catch (error) {
      this.meter.checkpoint();
      if (!this.context.isStopIteration(error)) throw error;
      return { done: true, value: undefined };
    }
  }
}
