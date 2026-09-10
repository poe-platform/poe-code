import type { RuntimeValue } from "./runtime-values.js";
import type { BinaryDispatch } from "./binary-dispatch.js";

export interface RuntimeNumericContext {
  /** Prepared numeric slots, excluding sequence concat/repeat fallbacks. */
  numeric?: BinaryDispatch<RuntimeValue>;
  /** Live dispatch records whether native subclass sequence slots survive overrides. */
  sequenceFallbacks?: { readonly left: boolean; readonly right: boolean };
  typeName?(value: RuntimeValue): string;
}

export const runtimeNumericMethods: ReadonlyMap<string, { readonly forward: string; readonly reflected: string; readonly inplace?: string }> = new Map<string, { forward: string; reflected: string; inplace?: string }>([
  ["+", "add"], ["-", "sub"], ["*", "mul"], ["@", "matmul"], ["/", "truediv"], ["//", "floordiv"],
  ["%", "mod"], ["**", "pow"], ["<<", "lshift"], [">>", "rshift"], ["&", "and"], ["^", "xor"], ["|", "or"]
].map(([operator, name]) => [operator, { forward: `__${name}__`, reflected: `__r${name}__`, inplace: `__i${name}__` }] as const)).set("divmod()", { forward: "__divmod__", reflected: "__rdivmod__" });

/** Opaque values use the supplied guest type policy. Exact native payloads
 * retain native slots; native-subclass storage needs a separate adapter. */
export function usesRuntimeGuestNumericSlots(value: RuntimeValue): boolean {
  switch (value.kind) {
    case "instance": case "cell": case "type": case "function": case "method": case "staticmethod": case "classmethod":
    case "builtin_function_or_method": case "getset_descriptor": case "member_descriptor": case "method_descriptor": case "classmethod_descriptor": case "wrapper_descriptor": case "method-wrapper": case "iterator": return true;
    default: return false;
  }
}
