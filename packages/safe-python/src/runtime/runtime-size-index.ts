import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Exact-value signed-size index conversion. Unlike search bounds, overflow
 * raises instead of saturating. Guest __index__ slots remain protocol work. */
export function runtimeSizeIndex(value: RuntimeValue, meter: ExecutionMeter): bigint {
  meter.checkpoint();
  if (value.kind === "bool") return value.value ? 1n : 0n;
  if (value.kind !== "int") {
    const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
    throw new PythonRuntimeError("TypeError", `'${type}' object cannot be interpreted as an integer`);
  }
  if (BigInt.asIntN(64, value.value) !== value.value) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
  return value.value;
}
