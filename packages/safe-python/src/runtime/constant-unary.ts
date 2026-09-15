import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { constantTruth } from "./constant-truth.js";
import { PythonRuntimeError } from "./error.js";

export interface ConstantUnaryContext {
  readonly values: ConstantValues;
  /** The runtime owns warning filtering, locations and warning-as-error policy. */
  warn(category: "DeprecationWarning", message: string): void;
}

/** Exact builtin slots only; user/subclass special methods belong to object
 * dispatch. Checkpoints and tagged-result allocations are metered, but host
 * bigint payload allocation and size-dependent CPU accounting remain pending.
 */
export function constantUnary(operator: string, value: ConstantValue, context: ConstantUnaryContext, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  const { values } = context;
  if (operator === "not") return values.boolean(!constantTruth(value, meter));
  if (operator !== "+" && operator !== "-" && operator !== "~") throw new Error(`unsupported constant unary operator: ${operator}`);
  switch (value.kind) {
    case "bool": {
      if (operator === "~") {
        context.warn("DeprecationWarning", "Bitwise inversion '~' on bool is deprecated and will be removed in Python 3.16. This returns the bitwise inversion of the underlying int object and is usually not what you expect from negating a bool. Use the 'not' operator for boolean negation or ~int(x) if you really want the bitwise inversion of the underlying int.");
        meter.checkpoint();
      }
      const integer = value.value ? 1n : 0n;
      return values.integer(operator === "+" ? integer : operator === "-" ? -integer : ~integer);
    }
    case "int": return operator === "+" ? value : values.integer(operator === "-" ? -value.value : ~value.value);
    case "float":
      if (operator === "+") return value;
      if (operator === "-") return values.float(-value.value);
      break;
    case "complex":
      if (operator === "+") return value;
      if (operator === "-") return values.complex(-value.real, -value.imaginary);
      break;
  }
  const name = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `bad operand type for unary ${operator}: '${name}'`);
}
