import { InputTypeError } from "./archive.js";

export function requireComparisonOperand(value: unknown): void {
  if (value === undefined) throw new InputTypeError("Expected a comparison operand.");
}
