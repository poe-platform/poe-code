import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import type { RuntimeRichComparisonContext } from "./runtime-rich-comparison.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Invoke only the receiver's comparison slot. No subtype reflection or final
 * identity fallback occurs here. Native container members still compare using
 * complete guest dispatch, as opposed to the single outer receiver slot. */
export function runtimeReceiverComparison(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context?: RuntimeRichComparisonContext, invocation?: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  if (context !== undefined) {
    const result = context.slots.forward(); meter.checkpoint(); return result;
  }
  // Numeric expression comparison combines both directions; a single native
  // receiver slot accepts only its own numeric widening direction.
  if ((left.kind === "int" || left.kind === "bool") && (right.kind === "float" || right.kind === "complex")
    || left.kind === "float" && right.kind === "complex") return values.notImplemented;
  meter.checkpoint(0, 96);
  return runtimeComparison(operator, left, right, values, meter, 1000, {
    declineUnsupported: true,
    comparison(op, a, b) {
      if (!usesRuntimeGuestNumericSlots(a) && !usesRuntimeGuestNumericSlots(b)) return undefined;
      if (invocation?.compare === undefined) throw Error("delegated comparison requires a comparison policy");
      const result = invocation.compare(op, a, b); meter.checkpoint(); return result;
    },
    truth: invocation?.truth?.bind(invocation)
  });
}
