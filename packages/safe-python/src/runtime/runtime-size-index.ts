import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";

/** Exact-value signed-size index conversion. Unlike search bounds, overflow
 * raises instead of saturating. Guest __index__ slots remain protocol work. */
export function runtimeSizeIndex(value: RuntimeValue, meter: ExecutionMeter): bigint {
  const index = runtimeIntegerIndex(value, meter);
  if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
  return index;
}
