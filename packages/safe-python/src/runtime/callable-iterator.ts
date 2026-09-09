import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface CallableIterationContext<Value> {
  isCallable(value: Value): boolean;
  call(callable: Value): Value;
  /** Sentinel-first rich equality including reflected dispatch and guest truth. */
  equal(sentinel: Value, result: Value): boolean;
  /** Guest StopIteration/subclasses only, never fatal execution-limit signals. */
  isStopIteration(error: unknown): boolean;
}

/** Host adapter for iter(callable, sentinel). A matching result or callable
 * StopIteration releases both captured values permanently. Equality errors do
 * not latch exhaustion, including StopIteration translated to a done result.
 * Reentrant calls can exhaust the adapter while a call/equality is in progress.
 * Guest iterator identity, exception values, call/compare dispatch and recursion
 * guards remain external; no implicit callable close is introduced.
 */
export class CallableIterator<Value> implements IterableIterator<Value> {
  #source: { callable: Value; sentinel: Value } | undefined;

  constructor(callable: Value, sentinel: Value, private readonly context: CallableIterationContext<Value>, private readonly meter: ExecutionMeter) {
    meter.checkpoint();
    const valid = context.isCallable(callable);
    meter.checkpoint();
    if (!valid) throw new PythonRuntimeError("TypeError", "iter(v, w): v must be callable");
    meter.checkpoint(0, 64);
    this.#source = { callable, sentinel };
  }

  [Symbol.iterator](): IterableIterator<Value> { return this; }

  next(): IteratorResult<Value> {
    this.meter.checkpoint(1, 16);
    const source = this.#source;
    if (source === undefined) return { done: true, value: undefined };
    let value: Value;
    try { value = this.context.call(source.callable); }
    catch (error) {
      this.meter.checkpoint();
      if (!this.context.isStopIteration(error)) throw error;
      this.#source = undefined;
      return { done: true, value: undefined };
    }
    this.meter.checkpoint();
    if (this.#source === undefined) return { done: true, value: undefined };
    let matches = Object.is(source.sentinel, value);
    if (!matches) {
      try { matches = this.context.equal(source.sentinel, value); }
      catch (error) {
        this.meter.checkpoint();
        if (!this.context.isStopIteration(error)) throw error;
        return { done: true, value: undefined };
      }
      this.meter.checkpoint();
    }
    if (!matches) return { done: false, value };
    this.#source = undefined;
    return { done: true, value: undefined };
  }
}
