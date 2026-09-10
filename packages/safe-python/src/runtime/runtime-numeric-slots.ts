import type { RuntimeValue } from "./runtime-values.js";

/** Opaque values use the supplied guest type policy. Exact native payloads
 * retain native slots; native-subclass storage needs a separate adapter. */
export function usesRuntimeGuestNumericSlots(value: RuntimeValue): boolean {
  switch (value.kind) {
    case "cell": case "type": case "function": case "method":
    case "builtin_function_or_method": case "getset_descriptor": case "iterator": return true;
    default: return false;
  }
}
