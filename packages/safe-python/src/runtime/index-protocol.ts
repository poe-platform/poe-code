import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface IntegerIndexContext<Value> {
  /** Pure payload inspection for int, bool and int subclasses only. */
  integer(value: Value): bigint | undefined;
  isExactInteger(value: Value): boolean;
  /** Type-level index-slot lookup/binding, never instance-attribute lookup.
   * Only an absent slot returns undefined. Disabled/non-callable slots fail
   * through the supplied lookup/call implementation. */
  lookupIndex(value: Value): (() => Value) | undefined;
  typeName(value: Value): string;
  /** Apply guest warning filters, including warning-as-error behavior. */
  warn(category: "DeprecationWarning", message: string): void;
}

/** Extract the exact integer payload used by Python's index protocol. Direct
 * int subclasses bypass overrides; method results must already be integers,
 * with a warning for strict subclasses. No __int__ fallback, recursion, machine
 * width clipping or float truncation is performed. Guest object construction,
 * slot dispatch and bigint payload accounting belong to callers/contexts.
 */
export function integerIndex<Value>(value: Value, context: IntegerIndexContext<Value>, meter: ExecutionMeter): bigint {
  meter.checkpoint();
  const direct = context.integer(value);
  if (direct !== undefined) return direct;
  const method = context.lookupIndex(value);
  meter.checkpoint();
  if (method === undefined) throw new PythonRuntimeError("TypeError", `'${context.typeName(value)}' object cannot be interpreted as an integer`);
  const result = method();
  meter.checkpoint();
  const integer = context.integer(result);
  if (integer === undefined) throw new PythonRuntimeError("TypeError", `__index__ returned non-int (type ${context.typeName(result)})`);
  if (!context.isExactInteger(result)) {
    context.warn("DeprecationWarning", `__index__ returned non-int (type ${context.typeName(result)}).  The ability to return an instance of a strict subclass of int is deprecated, and may be removed in a future version of Python.`);
    meter.checkpoint();
  }
  return integer;
}
