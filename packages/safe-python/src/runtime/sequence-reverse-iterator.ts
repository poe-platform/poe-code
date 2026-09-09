import type { ExecutionMeter } from "./execution-budget.js";

export interface ReverseSequenceContext<Value> {
  /** Validated, nonnegative signed-machine length from the sequence slot. */
  length(value: Value): bigint;
  getItem(value: Value, index: bigint): Value;
  /** Guest exceptions/subclasses only; never fatal execution-limit signals. */
  isIndexError(error: unknown): boolean;
  isStopIteration(error: unknown): boolean;
}

/** Indexed reversed fallback with an already validated initial length. Reads
 * live slots but captures each operation's position before guest callbacks.
 * Every item error exhausts the cursor; only IndexError/StopIteration become
 * done. Hint calls never exhaust it. Construction/slot dispatch, guest wrapping,
 * pickling and full allocation accounting remain external.
 */
export class SequenceReverseIterator<Value> implements IterableIterator<Value> {
  #source: { value: Value } | undefined;
  #index: bigint;

  constructor(source: Value, length: bigint, private readonly context: ReverseSequenceContext<Value>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#source = { value: source };
    this.#index = length - 1n;
  }

  [Symbol.iterator](): IterableIterator<Value> { return this; }

  lengthHint(): bigint {
    this.meter.checkpoint();
    const source = this.#source, index = this.#index;
    if (source === undefined || index < 0n) return 0n;
    const length = this.context.length(source.value);
    this.meter.checkpoint();
    return length < index + 1n ? 0n : index + 1n;
  }

  next(): IteratorResult<Value> {
    this.meter.checkpoint(1, 16);
    const source = this.#source, index = this.#index;
    if (source === undefined || index < 0n) {
      this.#source = undefined;
      this.#index = -1n;
      return { done: true, value: undefined };
    }
    let value: Value;
    try { value = this.context.getItem(source.value, index); }
    catch (error) {
      this.meter.checkpoint();
      this.#index = -1n;
      this.#source = undefined;
      let ended = this.context.isIndexError(error);
      this.meter.checkpoint();
      if (!ended) {
        ended = this.context.isStopIteration(error);
        this.meter.checkpoint();
      }
      if (!ended) throw error;
      return { done: true, value: undefined };
    }
    this.meter.checkpoint();
    this.#index = index - 1n;
    return { done: false, value };
  }
}
