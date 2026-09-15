import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";

/** Frame-owned __index__ binding/calls and warnings. Native integer payloads
 * are inspected directly; __int__ is never an index fallback. */
export function createRuntimeIndexContext(invocation: BuiltinInvocationContext, meter: ExecutionMeter): IntegerIndexContext<RuntimeValue> {
  meter.checkpoint(0, 320);
  return {
    integer(value) {
      const payload = runtimeIntegerPayload(value);
      return payload?.kind === "int" ? payload.value : payload?.kind === "bool" ? payload.value ? 1n : 0n : undefined;
    },
    isExactInteger: value => value.kind === "int",
    lookupIndex(value) {
      meter.checkpoint();
      if (!usesRuntimeGuestNumericSlots(value)) return undefined;
      const method = invocation.lookupSpecial?.(value, "__index__"); meter.checkpoint();
      if (method === undefined) return undefined;
      meter.checkpoint(0, 64);
      return () => { meter.checkpoint(0, 8); return invocation.call(method, []); };
    },
    typeName: value => (usesRuntimeGuestNumericSlots(value) ? invocation.typeName?.(value) : undefined) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind),
    warn: (category, message) => { invocation.warn?.(category, message); }
  };
}
