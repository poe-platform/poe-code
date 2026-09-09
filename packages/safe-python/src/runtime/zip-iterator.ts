import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Zip already-adapted input iterators, advancing them left to right. Strict
 * exhaustion probes later inputs only when the first input is exhausted, and
 * consumes the first unmatched value before reporting a longer input. No sticky
 * exhaustion is imposed: guest inputs can resume, and mismatch retries continue
 * from their actual consumed positions. Tuple construction belongs to the guest
 * factory. Caller owns argument/strict truth binding and eager iterator creation;
 * tuple reuse optimizations and full host heap accounting remain unfinished.
 */
export class ZipIterator<Value, Result> implements IterableIterator<Result> {
  readonly #sources: readonly Iterator<Value>[];

  constructor(sources: readonly Iterator<Value>[], private readonly strict: boolean, private readonly tuple: (values: readonly Value[]) => Result, private readonly meter: ExecutionMeter) {
    const length = sources.length;
    meter.checkpoint(1, 64 + length * 8);
    const copy = new Array<Iterator<Value>>(length);
    for (let i = 0; i < length; i++) { meter.checkpoint(); copy[i] = sources[i]; }
    this.#sources = Object.freeze(copy);
  }

  [Symbol.iterator](): IterableIterator<Result> { return this; }

  next(): IteratorResult<Result> {
    this.meter.checkpoint(1, 16);
    if (this.#sources.length === 0) return { done: true, value: undefined };
    this.meter.checkpoint(0, 32 + this.#sources.length * 8);
    const row = new Array<Value>(this.#sources.length);
    for (let i = 0; i < this.#sources.length; i++) {
      this.meter.checkpoint();
      const item = this.#sources[i].next();
      this.meter.checkpoint();
      if (item.done) {
        if (this.strict) this.#checkExhaustion(i);
        return { done: true, value: undefined };
      }
      row[i] = item.value;
    }
    this.meter.checkpoint(row.length);
    const value = this.tuple(Object.freeze(row));
    this.meter.checkpoint();
    return { done: false, value };
  }

  #checkExhaustion(index: number): void {
    if (index > 0) throw new PythonRuntimeError("ValueError", `zip() argument ${index + 1} is shorter than ${index === 1 ? "argument 1" : `arguments 1-${index}`}`);
    for (let i = 1; i < this.#sources.length; i++) {
      this.meter.checkpoint();
      const item = this.#sources[i].next();
      this.meter.checkpoint();
      if (!item.done) throw new PythonRuntimeError("ValueError", `zip() argument ${i + 1} is longer than ${i === 1 ? "argument 1" : `arguments 1-${i}`}`);
    }
  }
}
