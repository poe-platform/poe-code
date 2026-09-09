import type { Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readStringExpression } from "./string-expressions.js";
import { readExpression } from "./expression.js";

/** Pattern literals exclude arbitrary expression operators and interpolated strings. */
export function readPatternLiteral(cursor: TokenCursor): Expression {
  const first = cursor.peek();
  if (first.kind === "string" || first.kind === "bytes") {
    const value = readStringExpression(cursor, readExpression);
    if (value.kind !== "literal") throw cursor.error("patterns cannot use interpolated strings");
    return value;
  }
  if (["True", "False", "None"].includes(first.text)) {
    cursor.take();
    return { kind: "literal", literalKind: first.text === "None" ? "none" : "boolean", value: first.text === "None" ? null : first.text === "True", start: first.start, end: first.end };
  }
  const negative = first.text === "-";
  if (negative) cursor.take();
  const number = readNumberLiteral(cursor);
  let value: Expression = negative ? { kind: "unary", operator: "-", operand: number, start: first.start, end: number.end } : number;
  if (cursor.peek().text === "+" || cursor.peek().text === "-") {
    if (number.literalKind === "imaginary") throw cursor.error("real number required in complex pattern");
    const operator = cursor.take().text;
    const imaginary = readNumberLiteral(cursor);
    if (imaginary.literalKind !== "imaginary") throw cursor.error("imaginary number required in complex pattern");
    value = { kind: "binary", operator, left: value, right: imaginary, start: first.start, end: imaginary.end };
  }
  return value;
}

function readNumberLiteral(cursor: TokenCursor): Extract<Expression, { kind: "literal" }> {
  const token = cursor.peek();
  if (token.kind !== "integer" && token.kind !== "float" && token.kind !== "imaginary") throw cursor.error("expected numeric pattern literal");
  cursor.take();
  return { kind: "literal", literalKind: token.kind, value: token.value, start: token.start, end: token.end };
}
