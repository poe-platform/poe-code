import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";

/** Signed-size index conversion. Unlike search bounds, overflow raises instead
 * of saturating. Optional capabilities supply guest index slots. */
export function runtimeSizeIndex(value: RuntimeValue, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): bigint {
  const index = context === undefined || value.kind === "int" || value.kind === "bool"
    ? runtimeIntegerIndex(value, meter) : integerIndex(value, context, meter);
  meter.checkpoint();
  if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
  return index;
}
