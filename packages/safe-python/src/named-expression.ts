import type { Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";

/** Only grammar productions admitting named_expression call this reader. */
export function readNamedExpression(cursor: TokenCursor, read: (cursor: TokenCursor) => Expression): Expression {
  const first = cursor.peek();
  const target = read(cursor);
  if (cursor.peek().text !== ":=") return target;
  if (first.kind !== "name" || target.kind !== "name" || first.end.offset !== target.end.offset) {
    throw cursor.error("assignment expression target must be an unparenthesized name");
  }
  if (target.spelling === "__debug__") throw cursor.error("cannot assign to __debug__");
  cursor.take();
  const value = read(cursor);
  return { kind: "assignment-expression", target, value, start: target.start, end: value.end };
}
