import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Exact list/tuple search bounds accept integers, not explicit None, and
 * saturate to the execution's signed index width before normalization. */
export function runtimeSearchBound(value: RuntimeValue | undefined, fallback: bigint, meter: ExecutionMeter): bigint {
  meter.checkpoint();
  if (value === undefined) return fallback;
  if (value.kind === "bool") return value.value ? 1n : 0n;
  if (value.kind !== "int") throw new PythonRuntimeError("TypeError", "slice indices must be integers or have an __index__ method");
  const index = value.value;
  return index < -9223372036854775808n ? -9223372036854775808n : index > 9223372036854775807n ? 9223372036854775807n : index;
}
