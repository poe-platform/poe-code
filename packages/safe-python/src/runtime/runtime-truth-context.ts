import type { ExecutionMeter } from "./execution-budget.js";
import type { BooleanTruthContext } from "./truth-protocol.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";

/** Bind guest boolean truth through the current frame, independently of the
 * length/index fallback. None in __bool__ explicitly disables truth conversion.
 */
export function createRuntimeTruthContext(invocation: BuiltinInvocationContext, meter: ExecutionMeter): BooleanTruthContext<RuntimeValue> {
  meter.checkpoint(0, 256);
  return {
    typeName(value) {
      const name = value.kind === "int" || value.kind === "bool" ? value.kind : invocation.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
      meter.checkpoint(); return name;
    },
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
