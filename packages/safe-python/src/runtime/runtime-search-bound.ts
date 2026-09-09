import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Search bounds saturate to the signed index width before normalization.
 * Text searches accept explicit None; list/tuple searches do not. */
export function runtimeSearchBound(value: RuntimeValue | undefined, fallback: bigint, meter: ExecutionMeter, acceptNone = false): bigint {
  meter.checkpoint();
  if (value === undefined || (acceptNone && value.kind === "none")) return fallback;
  if (value.kind === "bool") return value.value ? 1n : 0n;
  if (value.kind !== "int") throw new PythonRuntimeError("TypeError", acceptNone ? "slice indices must be integers or None or have an __index__ method" : "slice indices must be integers or have an __index__ method");
  const index = value.value;
  return index < -9223372036854775808n ? -9223372036854775808n : index > 9223372036854775807n ? 9223372036854775807n : index;
}
