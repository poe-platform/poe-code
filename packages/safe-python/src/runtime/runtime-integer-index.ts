import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Exact integer/Boolean index extraction without narrowing. Callers impose
 * their own C-int, signed-size or arbitrary-precision domain afterwards.
 * Guest __index__ slots remain separate object-protocol work. */
export function runtimeIntegerIndex(value: RuntimeValue, meter: ExecutionMeter): bigint {
  meter.checkpoint();
  if (value.kind === "bool") return value.value ? 1n : 0n;
  if (value.kind === "int") return value.value;
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `'${type}' object cannot be interpreted as an integer`);
}
