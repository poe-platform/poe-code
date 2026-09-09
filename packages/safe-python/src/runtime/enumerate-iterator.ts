import type { ExecutionMeter } from "./execution-budget.js";

/** Enumerate an already prepared iterator with an already converted integer
 * start. The factory creates the guest integer/tuple representation and owns its
 * allocation charges. Source adapters translate guest StopIteration to done;
 * this iterator deliberately adds no sticky exhaustion. Bigint payload/CPU
 * accounting, constructor binding and guest type wrapping remain external.
 */
export class EnumerateIterator<Value, Result> implements IterableIterator<Result> {
  #index: bigint;

  constructor(private readonly source: Iterator<Value>, start: bigint, private readonly pair: (index: bigint, value: Value) => Result, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#index = start;
  }

  [Symbol.iterator](): IterableIterator<Result> { return this; }

  next(): IteratorResult<Result> {
    this.meter.checkpoint(1, 16);
    const item = this.source.next();
    this.meter.checkpoint();
    if (item.done) return { done: true, value: undefined };
    // Pulling a guest source can reenter this iterator and advance its counter.
    const index = this.#index;
    this.#index = index + 1n;
    const value = this.pair(index, item.value);
    this.meter.checkpoint();
    return { done: false, value };
  }
}
