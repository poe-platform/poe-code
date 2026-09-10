import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeNumericMethods, usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Try only the left operand's type-level in-place method. Ordinary numeric
 * negotiation, native mutation and target write-back remain caller-owned. */
export function runtimeInPlaceSpecialMethod(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  const name = runtimeNumericMethods.get(operator)?.inplace;
  if (name === undefined) throw Error(`unsupported in-place operator: ${operator}`);
  if (!usesRuntimeGuestNumericSlots(left)) return values.notImplemented;
  const method = invocation.lookupSpecial?.(left, name);
  meter.checkpoint();
  if (method === undefined) return values.notImplemented;
  if (operator === "*" && runtimeListPayload(left) !== undefined && method.kind === "method-wrapper" && method.value.descriptor.value.sequenceOperator === operator) return values.notImplemented;
  meter.checkpoint(0, 16);
  const result = invocation.call(method, [right]);
  meter.checkpoint();
  if (result === values.notImplemented && runtimeListPayload(left) !== undefined) {
    if (invocation.binary === undefined) throw Error("declined native-subclass in-place operation requires a binary policy");
    const fallback = invocation.binary(operator, left, right); meter.checkpoint(); return fallback;
  }
  return result;
}
