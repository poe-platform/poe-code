import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";

/** Integer/Boolean index extraction without narrowing. Callers impose
 * their own C-int, signed-size or arbitrary-precision domain afterwards.
 * Optional capabilities supply guest __index__ slots. */
export function runtimeIntegerIndex(value: RuntimeValue, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): bigint {
  meter.checkpoint();
  if (value.kind === "bool") return value.value ? 1n : 0n;
  if (value.kind === "int") return value.value;
  if (context !== undefined) return integerIndex(value, context, meter);
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `'${type}' object cannot be interpreted as an integer`);
}
