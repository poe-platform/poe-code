import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface Member<Key, Value> {
  readonly key: Key;
  readonly value: Value;
  readonly previous: Member<Key, Value> | undefined;
}

/** Reverse cursor with constant-size creation. Removed pending entries retain
 * predecessor links until no cursor references them; membership checks skip
 * them without visiting new tail insertions. Size-preserving mutation follows
 * storage links, not CPython's internal table-compaction thresholds. Projection
 * is trusted host construction. Exact native heap/iterator costs remain pending.
 */
export class OrderedMapReverseIterator<Key, Value, Result> implements IterableIterator<Result> {
  #source: ReadonlySet<Member<Key, Value>> | undefined;
  #current: Member<Key, Value> | undefined;
  readonly #expectedSize: number;
  #remaining: number;
  #sizeError = false;

  constructor(source: ReadonlySet<Member<Key, Value>>, last: Member<Key, Value> | undefined, private readonly project: (key: Key, value: Value) => Result, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 48);
    this.#source = source;
    this.#current = last;
    this.#expectedSize = source.size;
    this.#remaining = source.size;
  }

  [Symbol.iterator](): IterableIterator<Result> { return this; }

  lengthHint(): number {
    this.meter.checkpoint();
    return this.#source?.size === this.#expectedSize ? this.#remaining : 0;
  }

  next(): IteratorResult<Result> {
    this.meter.checkpoint(1, 16);
    if (this.#sizeError) throw new PythonRuntimeError("RuntimeError", "dictionary changed size during iteration");
    if (this.#source === undefined) return { done: true, value: undefined };
    if (this.#source.size !== this.#expectedSize) {
      this.#sizeError = true;
      this.#source = undefined; this.#current = undefined;
      throw new PythonRuntimeError("RuntimeError", "dictionary changed size during iteration");
    }
    while (this.#current !== undefined) {
      this.meter.checkpoint();
      const entry = this.#current;
      this.#current = entry.previous;
      if (!this.#source.has(entry)) continue;
      this.#remaining--;
      const value = this.project(entry.key, entry.value);
      this.meter.checkpoint();
      return { done: false, value };
    }
    this.#source = undefined;
    return { done: true, value: undefined };
  }
}
