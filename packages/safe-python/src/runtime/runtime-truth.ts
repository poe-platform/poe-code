import { constantTruth } from "./constant-truth.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Exact builtin records only. Future subclass/user-object dispatch must resolve
 * guest truth slots separately. Range truth uses its arbitrary-precision length,
 * not len()'s signed-size conversion. Iterators remain truthy after exhaustion.
 */
export function runtimeTruth(value: RuntimeValue, meter: ExecutionMeter): boolean {
  meter.checkpoint();
  switch (value.kind) {
    case "list": return value.items.length !== 0;
    case "dict": return value.items.size !== 0;
    case "range": return value.value.length !== 0n;
    case "iterator": case "function": case "builtin_function_or_method": return true;
    default: return constantTruth(value, meter);
  }
}
