import type { Expression } from "./ast.js";

type NumericConstant = { real: bigint | number; imaginary: number };

/** Equality keys for literal mapping patterns, never for dynamic attribute lookups. */
export function patternLiteralKey(expression: Expression): string | undefined {
  if (expression.kind === "literal") {
    if (expression.literalKind === "none") return "none";
    if (expression.value instanceof Uint32Array) return `string:${expression.value.join(",")}`;
    if (expression.value instanceof Uint8Array) return `bytes:${expression.value.join(",")}`;
  }
  const numeric = numericConstant(expression);
  if (!numeric) return undefined;
  // Integral floats share Python equality with their exact integer value, not a
  // rounded conversion of the other integer operand to JavaScript Number.
  const real = typeof numeric.real === "number" && Number.isInteger(numeric.real) ? BigInt(numeric.real).toString() : String(numeric.real);
  return numeric.imaginary === 0 ? `number:${real}` : `complex:${real}:${numeric.imaginary}`;
}

function numericConstant(expression: Expression): NumericConstant | undefined {
  if (expression.kind === "literal") {
    if (typeof expression.value === "bigint") return { real: expression.value, imaginary: 0 };
    if (typeof expression.value === "boolean") return { real: Number(expression.value), imaginary: 0 };
    if (typeof expression.value === "number") return expression.literalKind === "imaginary"
      ? { real: 0, imaginary: expression.value } : { real: expression.value, imaginary: 0 };
  }
  if (expression.kind === "unary" && expression.operator === "-") {
    const operand = numericConstant(expression.operand);
    if (operand) return { real: -operand.real, imaginary: -operand.imaginary };
  }
  if (expression.kind === "binary" && (expression.operator === "+" || expression.operator === "-")) {
    const left = numericConstant(expression.left);
    const right = numericConstant(expression.right);
    if (left && right) {
      // Combining real and imaginary literals produces a double-precision complex
      // constant in Python, including conversion of an arbitrary-precision real.
      return expression.operator === "+"
        ? { real: Number(left.real) + Number(right.real), imaginary: left.imaginary + right.imaginary }
        : { real: Number(left.real) - Number(right.real), imaginary: left.imaginary - right.imaginary };
    }
  }
  return undefined;
}
