import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";
import { validateIndexResult, type IntegerIndexContext } from "./index-protocol.js";

/** Search bounds saturate to the signed index width before normalization.
 * Text searches accept explicit None; list/tuple searches do not. */
export function runtimeSearchBound(value: RuntimeValue | undefined, fallback: bigint, meter: ExecutionMeter, acceptNone = false, context?: IntegerIndexContext<RuntimeValue>): bigint {
  meter.checkpoint();
  if (value === undefined || (acceptNone && value.kind === "none")) return fallback;
  if (value.kind === "bool") return value.value ? 1n : 0n;
  let index = value.kind === "int" ? value.value : context?.integer(value);
  if (index === undefined && context !== undefined) {
    const slot = context.lookupIndex(value);
    meter.checkpoint();
    if (slot !== undefined) index = context.integer(validateIndexResult(slot(), context, meter));
  }
  meter.checkpoint();
  if (index === undefined) throw new PythonRuntimeError("TypeError", acceptNone ? "slice indices must be integers or None or have an __index__ method" : "slice indices must be integers or have an __index__ method");
  return index < -9223372036854775808n ? -9223372036854775808n : index > 9223372036854775807n ? 9223372036854775807n : index;
}
