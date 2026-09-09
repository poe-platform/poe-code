import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { SequenceIterator } from "./sequence-iterator.js";

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

/** Resolve once without wrapping a guest iterator or advancing any cursor. */
export function resolveIteration<Value>(value: Value, context: IterationContext<Value>, meter: ExecutionMeter): { value: Value; sequence: boolean } {
  meter.checkpoint(1, 64);
  const iter = context.lookupIter(value);
  meter.checkpoint();
  if (iter === undefined) {
    const sequence = context.hasSequenceItem(value);
    meter.checkpoint();
    if (!sequence) {
      const name = context.typeName(value); meter.checkpoint();
      throw new PythonRuntimeError("TypeError", `'${name}' object is not iterable`);
    }
    return { value, sequence: true };
  }
  const result = iter(); meter.checkpoint();
  const valid = context.hasNext(result); meter.checkpoint();
  if (!valid) {
    const name = context.typeName(result); meter.checkpoint();
    throw new PythonRuntimeError("TypeError", `iter() returned non-iterator of type '${name}'`);
  }
  return { value: result, sequence: false };
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
  readonly #source: { value: Value } | undefined;
  readonly #sequence: SequenceIterator<Value> | undefined;

  constructor(value: Value, private readonly context: IterationContext<Value>, private readonly meter: ExecutionMeter) {
    const source = resolveIteration(value, context, meter);
    this.#source = source.sequence ? undefined : source;
    this.#sequence = source.sequence ? new SequenceIterator(source.value, context, meter) : undefined;
  }

  [Symbol.iterator](): IterableIterator<Value> { return this; }

  next(): IteratorResult<Value> {
    if (this.#sequence !== undefined) return this.#sequence.next();
    this.meter.checkpoint(1, 16);
    let value: Value;
    try { value = this.context.next(this.#source!.value); }
    catch (error) {
      this.meter.checkpoint();
      const ended = this.context.isStopIteration(error); this.meter.checkpoint();
      if (!ended) throw error;
      return { done: true, value: undefined };
    }
    this.meter.checkpoint();
    return { done: false, value };
  }
}
