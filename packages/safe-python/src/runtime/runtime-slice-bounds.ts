import type { SliceConstant } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

function bound(value: RuntimeValue, meter: ExecutionMeter): bigint | null {
  meter.checkpoint();
  if (value.kind === "none") return null;
  if (value.kind === "int") return value.value;
  if (value.kind === "bool") return value.value ? 1n : 0n;
  throw new PythonRuntimeError("TypeError", "slice indices must be integers or None or have an __index__ method");
}

/** Convert exact builtin components in Python order; normalization against a
 * particular sequence length happens later, after any required iterable effects.
 * User-defined __index__ slots require the guest object protocol layer.
 */
export function runtimeSliceBounds(key: SliceConstant<RuntimeValue>, meter: ExecutionMeter): { start: bigint | null; stop: bigint | null; step: bigint | null } {
  const step = bound(key.step, meter);
  if (step === 0n) throw new PythonRuntimeError("ValueError", "slice step cannot be zero");
  const start = bound(key.start, meter), stop = bound(key.stop, meter);
  meter.checkpoint(1, 32);
  return { start, stop, step };
}
