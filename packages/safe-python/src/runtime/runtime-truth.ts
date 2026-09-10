import { constantTruth } from "./constant-truth.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";
import { createRuntimeTruthContext } from "./runtime-truth-context.js";
import { protocolTruth } from "./truth-protocol.js";

/** Exact native payloads retain direct truth operations; opaque object records
 * may resolve type-level slots through an invocation. Range truth uses its arbitrary-precision length,
 * not len()'s signed-size conversion. Iterators remain truthy after exhaustion.
 */
export function runtimeTruth(value: RuntimeValue, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): boolean {
  meter.checkpoint();
  switch (value.kind) {
    case "list": return value.items.length !== 0;
    case "dict": case "set": case "frozenset": return value.items.size !== 0;
    case "mappingproxy": case "dict_keys": case "dict_values": case "dict_items": return value.value.items.size !== 0;
    case "range": return value.value.length !== 0n;
    case "iterator": case "function": case "builtin_function_or_method": case "method": case "cell": case "type": case "getset_descriptor":
      return invocation === undefined ? true : protocolTruth(value, createRuntimeTruthContext(invocation, meter), meter);
    default: return constantTruth(value, meter);
  }
}
