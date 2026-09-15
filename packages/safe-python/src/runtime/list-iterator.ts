import type { ExecutionMeter } from "./execution-budget.js";

/** A live index cursor over owned list slots. Forward iteration observes append
 * and positional shifts; reverse iteration captures its initial last index.
 * Unlike dictionary cursors, size mutation is not an error. A failed bounds
 * check during next permanently exhausts the cursor and releases its source;
 * length hints alone never do so. Guest iterator types/StopIteration conversion
 * and full host allocation accounting belong to the wider runtime.
 */
export class ListIterator<Value> implements IterableIterator<Value> {
  #source: readonly Value[] | undefined;
  #index: number;
  readonly #step: 1 | -1;

  constructor(source: readonly Value[], reverse: boolean, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 48);
    this.#source = source;
    this.#index = reverse ? source.length - 1 : 0;
    this.#step = reverse ? -1 : 1;
  }

  [Symbol.iterator](): IterableIterator<Value> { return this; }

  get typeName(): string { return this.#step === 1 ? "list_iterator" : "list_reverseiterator"; }

  lengthHint(): number {
    this.meter.checkpoint();
    const source = this.#source;
    if (source === undefined) return 0;
    return this.#step === 1 ? Math.max(0, source.length - this.#index)
      : this.#index >= source.length ? 0 : Math.max(0, this.#index + 1);
  }

  next(): IteratorResult<Value> {
    this.meter.checkpoint(1, 16);
    const source = this.#source;
    if (source === undefined || this.#index < 0 || this.#index >= source.length) {
      this.#source = undefined;
      return { done: true, value: undefined };
    }
    const value = source[this.#index];
    this.#index += this.#step;
    return { done: false, value };
  }
}
