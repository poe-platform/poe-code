import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeLengthContext } from "./runtime-length-context.js";
import type { TruthProtocolContext } from "./truth-protocol.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";

/** Bind guest truth slots through the current frame. Length/index validation
 * is shared with len(); None in __bool__ explicitly disables truth conversion.
 */
export function createRuntimeTruthContext(invocation: BuiltinInvocationContext, meter: ExecutionMeter): TruthProtocolContext<RuntimeValue> {
  meter.checkpoint(0, 192);
  return {
    ...createRuntimeLengthContext(invocation, meter),
    boolean: value => value.kind === "bool" ? value.value : undefined,
    isNone: value => value.kind === "none",
    lookupBool(value) {
      const method = invocation.lookupSpecial?.(value, "__bool__"); meter.checkpoint();
      if (method === undefined) return undefined;
      if (method.kind === "none") return null;
      meter.checkpoint(0, 64);
      return () => { meter.checkpoint(0, 8); return invocation.call(method, []); };
    }
  };
}
