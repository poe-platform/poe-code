import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface DictionaryCursorSource<Key, Value> {
  readonly size: number;
  nextDictionaryEntry(position: number, reverse: boolean): Readonly<{ position: number; key: Key; value: Value }> | undefined;
}

/** A dictionary cursor retains a table position, never an entry or host cursor.
 * Storage is resolved on every next so clear, table replacement and compaction
 * remain observable. Projection is trusted construction, not a guest callback.
 * Canonical guest types, descriptors and reduction are owned outside this kernel.
 */
export class DictionaryStorageIterator<Key, Value, Result> implements IterableIterator<Result> {
  #source: DictionaryCursorSource<Key, Value> | undefined;
  readonly #expectedSize: number;
  #remaining: number;
  #sizeError = false;

  constructor(source: DictionaryCursorSource<Key, Value>, private position: number, private readonly reverse: boolean, private readonly project: (key: Key, value: Value) => Result, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#source = source;
    this.#expectedSize = this.#remaining = source.size;
  }

  [Symbol.iterator](): IterableIterator<Result> { return this; }

  lengthHint(): bigint {
    this.meter.checkpoint(1, 32);
    // CPython publishes di_len using PyLong_FromSize_t on the pinned platform.
    return !this.#sizeError && this.#source?.size === this.#expectedSize ? BigInt.asUintN(64, BigInt(this.#remaining)) : 0n;
  }

  next(): IteratorResult<Result> {
    this.meter.checkpoint(1, 16);
    if (this.#sizeError) throw new PythonRuntimeError("RuntimeError", "dictionary changed size during iteration");
    const source = this.#source;
    if (source === undefined) return { done: true, value: undefined };
    if (source.size !== this.#expectedSize) {
      this.#sizeError = true;
      throw new PythonRuntimeError("RuntimeError", "dictionary changed size during iteration");
    }
    const item = source.nextDictionaryEntry(this.position, this.reverse);
    if (item === undefined) {
      this.#source = undefined;
      return { done: true, value: undefined };
    }
    if (!this.reverse && this.#remaining === 0) {
      this.#source = undefined;
      throw new PythonRuntimeError("RuntimeError", "dictionary keys changed during iteration");
    }
    this.position = item.position;
    this.#remaining--;
    const value = this.project(item.key, item.value);
    this.meter.checkpoint();
    return { done: false, value };
  }
}
