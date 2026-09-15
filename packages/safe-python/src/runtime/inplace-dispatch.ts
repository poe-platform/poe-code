import type { ExecutionMeter } from "./execution-budget.js";

/** Try the left operand's in-place special method before ordinary binary
 * negotiation. The method callback returns NotImplemented when absent; a
 * non-callable method raises instead. Fallback performs fresh binary dispatch
 * after any method-side mutation. Callbacks own their internal execution meter.
 * This does not store into the augmented-assignment target or undo mutations
 * when a callback, target store, or execution-budget check fails.
 */
export function dispatchInPlaceOperation<Value>(
  inPlace: () => Value, binaryFallback: () => Value, notImplemented: Value,
  meter?: ExecutionMeter
): Value {
  meter?.checkpoint();
  meter?.checkpoint();
  const result = inPlace();
  meter?.checkpoint(0);
  if (result !== notImplemented) return result;
  meter?.checkpoint();
  const fallback = binaryFallback();
  meter?.checkpoint(0);
  return fallback;
}
