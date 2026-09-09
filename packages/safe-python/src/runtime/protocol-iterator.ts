import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface IterationContext<Value> {
  /** Resolve the type's __iter__ slot, including special lookup/binding. Return
   * undefined only if absent; explicit disabling/non-callability must raise.
   */
  lookupIter(value: Value): (() => Value) | undefined;
  /** Check the next slot, without invoking it or requiring another __iter__. */
  hasNext(value: Value): boolean;
  next(iterator: Value): Value;
  /** Legacy sequence-slot eligibility, not merely an instance attribute check. */
  hasSequenceItem(value: Value): boolean;
  getItem(sequence: Value, index: bigint): Value;
  /** Recognize guest exceptions/subclasses only, never fatal limit signals. */
  isStopIteration(error: unknown): boolean;
  isIndexError(error: unknown): boolean;
  typeName(value: Value): string;
}

/** Host adapter for guest iteration, including the legacy indexed fallback.
 * Custom guest iterators own their exhaustion state: StopIteration translates
 * this call to done but does not suppress subsequent guest next calls. Indexed
 * fallback latches exhaustion and releases its source on IndexError or
 * StopIteration. Other failures leave its index unchanged. Guest iterator type
 * identity, StopIteration values, descriptor dispatch and recursive-call limits
 * remain outside this adapter; no implicit close/return hook is introduced.
 */
export class ProtocolIterator<Value> implements IterableIterator<Value> {
  #source: { value: Value; sequence: boolean } | undefined;
  #index = 0n;

  constructor(value: Value, private readonly context: IterationContext<Value>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    const iter = context.lookupIter(value);
    meter.checkpoint();
    if (iter === undefined) {
      const sequence = context.hasSequenceItem(value);
      meter.checkpoint();
      if (!sequence) throw new PythonRuntimeError("TypeError", `'${context.typeName(value)}' object is not iterable`);
      this.#source = { value, sequence: true };
    } else {
      const result = iter();
      meter.checkpoint();
      const valid = context.hasNext(result);
      meter.checkpoint();
      if (!valid) throw new PythonRuntimeError("TypeError", `iter() returned non-iterator of type '${context.typeName(result)}'`);
      this.#source = { value: result, sequence: false };
    }
  }

  [Symbol.iterator](): IterableIterator<Value> { return this; }

  next(): IteratorResult<Value> {
    this.meter.checkpoint(1, 16);
    const source = this.#source;
    if (source === undefined) return { done: true, value: undefined };
    if (source.sequence && this.#index === (1n << 63n) - 1n) throw new PythonRuntimeError("OverflowError", "iter index too large");
    let value: Value;
    try { value = source.sequence ? this.context.getItem(source.value, this.#index) : this.context.next(source.value); }
    catch (error) {
      this.meter.checkpoint();
      if (!this.context.isStopIteration(error) && !(source.sequence && this.context.isIndexError(error))) throw error;
      if (source.sequence) this.#source = undefined;
      return { done: true, value: undefined };
    }
    this.meter.checkpoint();
    if (source.sequence) this.#index++;
    return { done: false, value };
  }
}
