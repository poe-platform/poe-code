import { constantUnary, type ConstantUnaryContext } from "./constant-unary.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Exact runtime value unary operations. Logical negation uses runtime truth;
 * numeric operations reuse the scalar slots and their warning policy. Guest
 * overridden slots and concrete iterator type names remain object-runtime work.
 */
export function runtimeUnary(operator: string, value: RuntimeValue, context: ConstantUnaryContext, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (operator === "not") return context.values.boolean(!runtimeTruth(value, meter));
  if (operator !== "+" && operator !== "-" && operator !== "~") throw new Error(`unsupported runtime unary operator: ${operator}`);
  switch (value.kind) {
    case "bool": case "int": case "float": case "complex": return constantUnary(operator, value, context, meter);
    default: {
      const name = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
      throw new PythonRuntimeError("TypeError", `bad operand type for unary ${operator}: '${name}'`);
    }
  }
}
