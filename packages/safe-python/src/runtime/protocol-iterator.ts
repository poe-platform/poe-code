import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { SequenceIterator } from "./sequence-iterator.js";
import type { CompletionIterator, CompletionResult } from "./iterator-completion.js";
import { lengthHint, type LengthHintContext } from "./length-hint.js";
import {PreparedIterator} from "./prepared-iterator.js";

export interface IterationContext<Value> {
  /** Optional advisory-size capability for consumers that request length hints.
   * Merely acquiring or advancing an iterator never invokes it. */
  readonly hints?: LengthHintContext<Value>;
  /** Resolve the type's __iter__ slot, including special lookup/binding. Return
   * undefined only if absent; explicit disabling/non-callability must raise.
   */
  lookupIter(value: Value): (() => Value) | undefined;
  /** Check the next slot, without invoking it or requiring another __iter__. */
  hasNext(value: Value): boolean;
  next(iterator: Value): Value;
  /** Adapt a prepared native cursor after iterator validation, without another
   * __iter__ call. Its completion metadata is already classified; never convert
   * it to a throw and then reclassify it through the guest exception policy. */
  nativeIterator?(iterator: Value): CompletionIterator<Value> | undefined;
  /** Legacy sequence-slot eligibility, not merely an instance attribute check. */
  hasSequenceItem(value: Value): boolean;
  getItem(sequence: Value, index: bigint): Value;
  /** Recognize guest exceptions/subclasses only, never fatal limit signals. */
  isStopIteration(error: unknown): boolean;
  isIndexError(error: unknown): boolean;
  typeName(value: Value): string;
}

/** Resolve once without wrapping a guest iterator or advancing any cursor.
 * A consumer may specialize only the absent-slot diagnostic; invocation,
 * binding and invalid-iterator errors never enter that callback. */
export function resolveIteration<Value>(value: Value, context: IterationContext<Value>, meter: ExecutionMeter, notIterable?: (typeName: string) => never): { value: Value; sequence: boolean } {
  meter.checkpoint(1, 64);
  const iter = context.lookupIter(value);
  meter.checkpoint();
  if (iter === undefined) {
    const sequence = context.hasSequenceItem(value);
    meter.checkpoint();
    if (!sequence) {
      const name = context.typeName(value); meter.checkpoint();
      if (notIterable !== undefined) return notIterable(name);
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
 * identity, descriptor dispatch and recursive-call limits
 * remain outside this adapter; no implicit close/return hook is introduced.
 */
export class ProtocolIterator<Value> implements IterableIterator<Value> {
  readonly #source: { value: Value } | undefined;
  readonly #sequence: SequenceIterator<Value> | undefined;
  readonly #prepared: PreparedIterator<Value> | undefined;

  constructor(value: Value, private readonly context: IterationContext<Value>, private readonly meter: ExecutionMeter, notIterable?: (typeName: string) => never) {
    const source = resolveIteration(value, context, meter, notIterable);
    meter.checkpoint(0, 8);
    this.#prepared = source.sequence ? undefined : new PreparedIterator(source.value,context,meter);
    meter.checkpoint();
    this.#source = source.sequence ? undefined : source;
    this.#sequence = source.sequence ? new SequenceIterator(source.value, context, meter) : undefined;
  }

  [Symbol.iterator](): IterableIterator<Value> { return this; }

  /** Perform guest iter(cursor), distinct from adapting this host iterator.
   * Legacy sequence cursors are self-iterating and keep their current index. */
  reacquire(): ProtocolIterator<Value> {
    this.meter.checkpoint();
    return this.#source === undefined ? this : new ProtocolIterator(this.#source.value, this.context, this.meter);
  }

  /** Inspect this guest cursor, not a replacement returned by reacquisition.
   * Byte collectors can explicitly select the original iterable instead.
   * The result is advisory and must not control how many items are consumed. */
  lengthHint(fallback = 0n, source?: Value): bigint {
    this.meter.checkpoint();
    const hints = this.context.hints;
    if (hints === undefined) return fallback;
    if (source !== undefined) return lengthHint(source, hints, this.meter, fallback);
    return this.#sequence !== undefined ? this.#sequence.lengthHint(hints, fallback)
      : lengthHint(this.#source!.value, hints, this.meter, fallback);
  }

  next(): CompletionResult<Value> {
    if (this.#sequence !== undefined) return this.#sequence.next();
    return this.#prepared!.next();
  }
}
