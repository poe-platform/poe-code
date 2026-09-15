import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { indexObject, type IntegerIndexContext } from "./index-protocol.js";

export interface LengthProtocolContext<Value> extends IntegerIndexContext<Value> {
  /** Resolve the type's length slot, including descriptor binding. Only slot
   * absence returns undefined; disabled/non-callable slots must fail. */
  lookupLength(value: Value): (() => Value) | undefined;
}

/** Convert an optional __len__ result through the integer-index protocol.
 * Negativity is rejected before signed 64-bit overflow. Absence is distinct
 * from invalid/call-failing slots so len, truth and length_hint can apply their
 * own fallback rules. Concrete slot lookup, builtin dispatch, diagnostic name
 * bounds and full bigint allocation accounting remain context responsibilities.
 */
export function optionalLength<Value>(value: Value, context: LengthProtocolContext<Value>, meter: ExecutionMeter): bigint | undefined {
  meter.checkpoint();
  const method = context.lookupLength(value);
  meter.checkpoint();
  if (method === undefined) return undefined;
  const result = method();
  meter.checkpoint();
  const indexed = indexObject(result, context, meter);
  const length = context.integer(indexed) as bigint;
  if (length < 0n) throw new PythonRuntimeError("ValueError", "__len__() should return >= 0");
  if (BigInt.asIntN(64, length) !== length) throw new PythonRuntimeError("OverflowError", `cannot fit '${context.typeName(indexed)}' into an index-sized integer`);
  return length;
}
