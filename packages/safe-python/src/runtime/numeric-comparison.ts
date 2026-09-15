import type { ConstantValue, ConstantValues, PrimitiveConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { compareReal } from "./real-comparison.js";

export type NumericConstant = Extract<PrimitiveConstant, { kind: "bool" | "int" | "float" | "complex" }>;

/** Compare a pair of exact builtin numbers after type/subclass dispatch. This
 * combines builtin numeric negotiation; it is NOT int.__eq__ or another single
 * type's exposed slot (which may decline operands handled by a reflected slot).
 * Declined pairs return NotImplemented, never a guessed equality or ordering
 * error. No identity shortcut: even the same NaN object is unequal to itself.
 * Host bigint comparison CPU accounting remains size-independent for now.
 */
export function numericComparison(operator: string, left: NumericConstant, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (operator !== "==" && operator !== "!=" && operator !== "<" && operator !== ">" && operator !== "<=" && operator !== ">=") throw new Error(`unsupported numeric comparison operator: ${operator}`);
  if (right.kind !== "bool" && right.kind !== "int" && right.kind !== "float" && right.kind !== "complex") return values.notImplemented;
  const leftReal = left.kind === "complex" ? left.real : left.kind === "bool" ? (left.value ? 1n : 0n) : left.value;
  const rightReal = right.kind === "complex" ? right.real : right.kind === "bool" ? (right.value ? 1n : 0n) : right.value;
  if (left.kind === "complex" || right.kind === "complex") {
    if (operator !== "==" && operator !== "!=") return values.notImplemented;
    const leftImaginary = left.kind === "complex" ? left.imaginary : 0;
    const rightImaginary = right.kind === "complex" ? right.imaginary : 0;
    const equal = leftImaginary === rightImaginary && compareReal(leftReal, rightReal) === 0;
    return values.boolean(operator === "==" ? equal : !equal);
  }
  const order = compareReal(leftReal, rightReal);
  switch (operator) {
    case "==": return values.boolean(order === 0);
    case "!=": return values.boolean(order !== 0);
    case "<": return values.boolean(order === -1);
    case ">": return values.boolean(order === 1);
    case "<=": return values.boolean(order === -1 || order === 0);
    case ">=": return values.boolean(order === 1 || order === 0);
  }
}
