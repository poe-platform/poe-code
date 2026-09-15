import { constantUnary, type ConstantUnaryContext } from "./constant-unary.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeTruth } from "./runtime-truth.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";

export type RuntimeUnaryProtocol = Pick<BuiltinInvocationContext, "lookupSpecial" | "call" | "typeName">;

/** Exact runtime value unary operations. Logical negation uses runtime truth;
 * numeric operations reuse the scalar slots and their warning policy. Opaque
 * operands use the supplied type-level protocol, never index coercion. Unlike
 * binary methods, unary methods may return NotImplemented as an ordinary value.
 */
export function runtimeUnary(operator: string, value: RuntimeValue, context: ConstantUnaryContext, meter: ExecutionMeter, invocation?: RuntimeUnaryProtocol): RuntimeValue {
  meter.checkpoint();
  if (operator === "not") return context.values.boolean(!runtimeTruth(value, meter));
  if (operator !== "+" && operator !== "-" && operator !== "~") throw new Error(`unsupported runtime unary operator: ${operator}`);
  switch (value.kind) {
    case "bool": case "int": case "float": case "complex": return constantUnary(operator, value, context, meter);
    default: {
      const guest = usesRuntimeGuestNumericSlots(value);
      if (guest) {
        const method = invocation?.lookupSpecial?.(value, operator === "+" ? "__pos__" : operator === "-" ? "__neg__" : "__invert__");
        meter.checkpoint();
        if (method !== undefined) {
          meter.checkpoint(0, 8);
          const result = invocation!.call(method, []); meter.checkpoint(); return result;
        }
      }
      const name = (guest ? invocation?.typeName?.(value) : undefined) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
      throw new PythonRuntimeError("TypeError", `bad operand type for unary ${operator}: '${diagnosticTypeName(name, meter)}'`);
    }
  }
}
