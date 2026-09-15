import type { Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readStringExpression } from "./string-expressions.js";
import { readExpression } from "./expression.js";

/** Pattern literals exclude arbitrary expression operators and interpolated strings. */
export function readPatternLiteral(cursor: TokenCursor): Expression {
  try {
  cursor.meter?.checkpoint();
  const first = cursor.peek();
  if (first.kind === "string" || first.kind === "bytes") {
    const value = readStringExpression(cursor, readExpression);
    if (value.kind !== "literal") throw cursor.error("patterns cannot use interpolated strings");
    return value;
  }
  if (first.text==="True"||first.text==="False"||first.text==="None") {
    cursor.take();
    cursor.meter?.checkpoint(0,80);
    return { kind: "literal", literalKind: first.text === "None" ? "none" : "boolean", value: first.text === "None" ? null : first.text === "True", start: first.start, end: first.end };
  }
  const negative = first.text === "-";
  if (negative) cursor.take();
  const number = readNumberLiteral(cursor);
  if(negative)cursor.meter?.checkpoint(0,80);
  let value: Expression = negative ? { kind: "unary", operator: "-", operand: number, start: first.start, end: number.end } : number;
  if (cursor.peek().text === "+" || cursor.peek().text === "-") {
    if (number.literalKind === "imaginary") throw cursor.error("real number required in complex pattern");
    if (typeof number.value === "bigint") {
      cursor.meter?.checkpoint(1+number.end.offset-number.start.offset);
      if(!Number.isFinite(Number(number.value)))throw cursor.error("real part of complex pattern is too large");
    }
    const operator = cursor.take().text;
    const imaginary = readNumberLiteral(cursor);
    if (imaginary.literalKind !== "imaginary") throw cursor.error("imaginary number required in complex pattern");
    cursor.meter?.checkpoint(0,96);
    value = { kind: "binary", operator, left: value, right: imaginary, start: first.start, end: imaginary.end };
  }
  return value;
  } finally {cursor.meter?.checkpoint();}
}

function readNumberLiteral(cursor: TokenCursor): Extract<Expression, { kind: "literal" }> {
  const token = cursor.peek();
  if (token.kind !== "integer" && token.kind !== "float" && token.kind !== "imaginary") throw cursor.error("expected numeric pattern literal");
  cursor.take();
  cursor.meter?.checkpoint(0,80);
  return { kind: "literal", literalKind: token.kind, value: token.value, start: token.start, end: token.end };
}
