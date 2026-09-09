import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface Member<Key, Value> { readonly key: Key; readonly value: Value }

/** Forward hash-storage cursor. Projection is trusted host construction (key,
 * value or item tuple), not guest iteration dispatch. Value updates are live.
 * Observed size changes latch an error; extra keys after the expected count
 * cause one keys-changed error followed by exhaustion in dictionary mode. Set
 * mode reports set-specific size errors without a dictionary keys-count check.
 * Size-preserving mutation
 * follows live storage order, not a promise about CPython table-resize details.
 * Exhaustion/errors release storage references. Logical state/results are
 * charged, but complete native iterator/host heap accounting remains pending.
 */
export class OrderedMapIterator<Key, Value, Result> implements IterableIterator<Result> {
  #source: ReadonlySet<Member<Key, Value>> | undefined;
  #iterator: Iterator<Member<Key, Value>> | undefined;
  readonly #expectedSize: number;
  #remaining: number;
  #sizeError = false;

  constructor(source: ReadonlySet<Member<Key, Value>>, private readonly project: (key: Key, value: Value) => Result, private readonly meter: ExecutionMeter, private readonly kind: "dictionary" | "set" = "dictionary") {
    meter.checkpoint(1, 48);
    this.#source = source;
    this.#expectedSize = source.size;
    this.#remaining = source.size;
    this.#iterator = source.values();
  }

  [Symbol.iterator](): IterableIterator<Result> { return this; }

  lengthHint(): number {
    this.meter.checkpoint();
    return this.#source?.size === this.#expectedSize ? Math.max(0, this.#remaining) : 0;
  }

  next(): IteratorResult<Result> {
    this.meter.checkpoint(1, 16);
    if (this.#sizeError) throw new PythonRuntimeError("RuntimeError", `${this.kind === "set" ? "Set" : "dictionary"} changed size during iteration`);
    if (this.#source === undefined) return { done: true, value: undefined };
    if (this.#source.size !== this.#expectedSize) {
      this.#sizeError = true;
      this.#source = undefined; this.#iterator = undefined;
      throw new PythonRuntimeError("RuntimeError", `${this.kind === "set" ? "Set" : "dictionary"} changed size during iteration`);
    }
    const item = this.#iterator!.next();
    if (item.done) {
      this.#source = undefined; this.#iterator = undefined;
      return { done: true, value: undefined };
    }
    if (this.kind === "dictionary" && this.#remaining === 0) {
      this.#source = undefined; this.#iterator = undefined;
      throw new PythonRuntimeError("RuntimeError", "dictionary keys changed during iteration");
    }
    this.#remaining--;
    const value = this.project(item.value.key, item.value.value);
    this.meter.checkpoint();
    return { done: false, value };
  }
}
