import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeHashContext } from "./runtime-hash.js";
import { PythonRuntimeError } from "./error.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext } from "./runtime-values.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";

/** Compose execution-owned hash slots with a trusted identity/payload policy.
 * Explicit guest policies take precedence. Absent owned slots retain the native
 * identity path; disabled slots and descriptor results use the hash protocol.
 * No instance attribute lookup or guest integer-index conversion is performed.
 */
export function createRuntimeHashContext(base: RuntimeHashContext, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeHashContext {
  if (invocation?.lookupSpecial === undefined || invocation.hasSpecial === undefined) return base;
  meter.checkpoint(0, 128);
  return {
    ...base,
    guestHash(value) {
      const explicit = base.guestHash?.(value); meter.checkpoint();
      if (explicit !== undefined) return explicit;
      if (!hasRuntimeInstanceAttributes(value) && value.kind !== "type") return undefined;
      const present = invocation.hasSpecial!(value, "__hash__"); meter.checkpoint();
      if (!present) return undefined;
      const type = value.kind === "type" ? value.metaclass : value.type;
      meter.checkpoint(0, 192);
      return {
        lookupHash() {
          let method;
          try { method = invocation.lookupSpecial!(value, "__hash__"); }
          catch (error) {
            meter.checkpoint();
            if (error instanceof PythonRuntimeError && error.name === "AttributeError") return null;
            throw error;
          }
          meter.checkpoint();
          if (method === undefined || method.kind === "none") return null;
          meter.checkpoint(0, 32);
          return () => invocation.call(method, []);
        },
        integer(result) {
          const payload = runtimeIntegerPayload(result);
          return payload?.kind === "int" ? payload.value : payload?.kind === "bool" ? payload.value ? 1n : 0n : undefined;
        },
        typeName: () => type.value.name
      };
    }
  };
}
