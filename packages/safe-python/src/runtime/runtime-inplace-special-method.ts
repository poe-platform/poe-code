import type { ExecutionMeter } from "./execution-budget.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

const inPlaceMethods = new Map([
  ["+", "__iadd__"], ["-", "__isub__"], ["*", "__imul__"], ["@", "__imatmul__"],
  ["/", "__itruediv__"], ["//", "__ifloordiv__"], ["%", "__imod__"], ["**", "__ipow__"],
  ["<<", "__ilshift__"], [">>", "__irshift__"], ["&", "__iand__"], ["^", "__ixor__"], ["|", "__ior__"]
]);

/** Try only the left operand's type-level in-place method. Ordinary numeric
 * negotiation, native mutation and target write-back remain caller-owned. */
export function runtimeInPlaceSpecialMethod(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  const name = inPlaceMethods.get(operator);
  if (name === undefined) throw Error(`unsupported in-place operator: ${operator}`);
  if (!usesRuntimeGuestNumericSlots(left)) return values.notImplemented;
  const method = invocation.lookupSpecial?.(left, name);
  meter.checkpoint();
  if (method === undefined) return values.notImplemented;
  meter.checkpoint(0, 16);
  const result = invocation.call(method, [right]);
  meter.checkpoint();
  return result;
}
