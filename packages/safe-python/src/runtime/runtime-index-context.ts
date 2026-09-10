import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";

/** Frame-owned __index__ binding/calls and warnings. Native integer payloads
 * are inspected directly; __int__ is never an index fallback. */
export function createRuntimeIndexContext(invocation: BuiltinInvocationContext, meter: ExecutionMeter): IntegerIndexContext<RuntimeValue> {
  meter.checkpoint(0, 320);
  return {
    integer: value => value.kind === "int" ? value.value : value.kind === "bool" ? value.value ? 1n : 0n : undefined,
    isExactInteger: value => value.kind === "int",
    lookupIndex(value) {
      const method = invocation.lookupSpecial?.(value, "__index__"); meter.checkpoint();
      if (method === undefined) return undefined;
      meter.checkpoint(0, 64);
      return () => { meter.checkpoint(0, 8); return invocation.call(method, []); };
    },
    typeName: value => value.kind === "int" || value.kind === "bool" ? value.kind : invocation.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind),
    warn: (category, message) => { invocation.warn?.(category, message); }
  };
}
