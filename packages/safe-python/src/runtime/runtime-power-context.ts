import { dispatchBinaryOperation } from "./binary-dispatch.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeNumericContext } from "./runtime-numeric-context.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import type { RuntimePowerContext } from "./runtime-power-operation.js";
import { runtimePower, runtimePowerSlot } from "./runtime-power.js";
import { runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import type { BuiltinInvocationContext, RuntimeValues } from "./runtime-values.js";

/** Frame-owned power protocol shared by ** and pow. Python heap power slots
 * negotiate the first two operands; a modulus never becomes the method receiver.
 * Distinct native modulus slots run only after that negotiation declines. */
export function createRuntimePowerContext(values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation: BuiltinInvocationContext): RuntimePowerContext {
  meter.checkpoint(0, 128);
  return {
    power(base, exponent, modulus) {
      const context = createRuntimeNumericContext("**", base, exponent, values, meter, special, invocation, modulus);
      if (context?.numeric === undefined) return runtimePower(base, exponent, modulus, values, meter);
      const result = dispatchBinaryOperation(context.numeric, meter);
      meter.checkpoint();
      if (result !== values.notImplemented || modulus.kind === "none" || usesRuntimeGuestNumericSlots(modulus) || modulus.kind === base.kind || modulus.kind === exponent.kind) return result;
      return runtimePowerSlot(modulus, base, exponent, modulus, values, meter);
    },
    typeName(value) {
      if (usesRuntimeGuestNumericSlots(value)) { const type = runtimeActualType(value, special, meter); meter.checkpoint(); return type.value.name; }
      return value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
    }
  };
}
