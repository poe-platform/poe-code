import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface LengthHintContext<Value> {
  /** Optional __len__ slot, including its guest __index__ conversion. Return
   * undefined only when no length slot exists; propagate guest call errors. */
  length(value: Value): bigint | undefined;
  /** Type-level special lookup, including descriptor binding. The returned
   * closure calls the bound method; a non-callable method must fail on call,
   * not during lookup. Instance attributes do not participate. */
  lookupHint(value: Value): (() => Value) | undefined;
  /** Extract int/bool/int-subclass payload only; do not invoke __index__. */
  integer(value: Value): bigint | undefined;
  isNotImplemented(value: Value): boolean;
  isTypeError(error: unknown): boolean;
  typeName(value: Value): string;
}

/** Python's advisory size protocol, without allocating from an untrusted hint.
 * Only call-time TypeError enables fallback; descriptor lookup and invalid
 * result errors propagate. Defaults are caller-converted signed index values
 * and can be negative (operator.length_hint permits this). Consumers remain
 * responsible for metering any reservation and never trusting a hint as an
 * exact iteration count. Guest slots/descriptor dispatch are supplied by context.
 */
export function lengthHint<Value>(value: Value, context: LengthHintContext<Value>, meter: ExecutionMeter, fallback = 0n): bigint {
  meter.checkpoint();
  let length: bigint | undefined;
  try { length = context.length(value); }
  catch (error) { if (!context.isTypeError(error)) throw error; }
  meter.checkpoint();
  if (length !== undefined) {
    if (BigInt.asIntN(64, length) !== length) throw new PythonRuntimeError("OverflowError", "cannot fit 'int' into an index-sized integer");
    if (length < 0n) throw new PythonRuntimeError("ValueError", "__len__() should return >= 0");
    return length;
  }
  const hint = context.lookupHint(value);
  meter.checkpoint();
  if (hint === undefined) return fallback;
  let result: Value;
  try { result = hint(); }
  catch (error) {
    if (!context.isTypeError(error)) throw error;
    meter.checkpoint();
    return fallback;
  }
  meter.checkpoint();
  if (context.isNotImplemented(result)) return fallback;
  const integer = context.integer(result);
  if (integer === undefined) throw new PythonRuntimeError("TypeError", `__length_hint__ must be an integer, not ${context.typeName(result)}`);
  if (BigInt.asIntN(64, integer) !== integer) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
  if (integer < 0n) throw new PythonRuntimeError("ValueError", "__length_hint__() should return >= 0");
  return integer;
}
