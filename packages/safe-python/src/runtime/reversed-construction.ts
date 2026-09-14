import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { SequenceReverseIterator, type ReverseSequenceContext } from "./sequence-reverse-iterator.js";

export interface ReversedConstructionContext<Value> extends ReverseSequenceContext<Value> {
  /** Type-level special lookup: undefined is absent, null is disabled by None.
   * Other non-callable attributes must raise through the returned call. */
  lookupReversed(value: Value): (() => Value) | null | undefined;
  /** Sequence-slot eligibility, excluding merely instance-level attributes. */
  hasSequenceItem(value: Value): boolean;
  typeName(value: Value): string;
  /** Construct and charge the guest wrapper for an indexed reverse iterator. */
  wrap(iterator: SequenceReverseIterator<Value>): Value;
}

/** Bind exact builtin reversed calls. Custom method results are returned as-is,
 * without requiring iterator shape. Only absence enables indexed fallback;
 * sequence eligibility precedes eager validated length acquisition. Concrete
 * descriptors/slots, guest type registration and subclass construction remain
 * external; next/getitem is never called during construction.
 */
export function constructReversed<Value>(positional: readonly Value[], keywords: { readonly size: number }, context: ReversedConstructionContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  if (keywords.size !== 0) throw new PythonRuntimeError("TypeError", "reversed() takes no keyword arguments");
  if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `reversed expected 1 argument, got ${positional.length}`);
  const source = positional[0], method = context.lookupReversed(source);
  meter.checkpoint();
  if (method !== undefined && method !== null) {
    const result = method();
    meter.checkpoint();
    return result;
  }
  const eligible = method !== null && context.hasSequenceItem(source);
  meter.checkpoint();
  if (!eligible) {
    const name = diagnosticTypeName(context.typeName(source), meter);
    meter.checkpoint();
    throw new PythonRuntimeError("TypeError", `'${name}' object is not reversible`);
  }
  const length = context.length(source);
  meter.checkpoint();
  const result = context.wrap(new SequenceReverseIterator(source, length, context, meter));
  meter.checkpoint();
  return result;
}
