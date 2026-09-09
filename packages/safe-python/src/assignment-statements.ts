import type { CollectionItem, Expression } from "./ast.js";
import type { Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readYield } from "./yield-expression.js";
import { validateTarget } from "./targets.js";

const augmentedOperators = new Set(["+=", "-=", "*=", "@=", "/=", "//=", "%=", "**=", "<<=", ">>=", "&=", "^=", "|="]);

export function readAssignmentOrExpression(cursor: TokenCursor): Statement {
  const first = cursor.peek();
  let value = readStatementValue(cursor);
  if (cursor.peek().text === ":") {
    validateSingleTarget(value, cursor);
    cursor.take();
    const annotation = readExpression(cursor);
    const assigned = cursor.peek().text === "=";
    if (assigned) cursor.take();
    const rhs = assigned ? readStatementValue(cursor) : null;
    return { kind: "annotated-assignment", target: value, value: rhs,
      simple: value.kind === "name" && first.kind === "name" && value.end.offset === first.end.offset,
      start: first.start, end: rhs?.end ?? annotation.end };
  }
  if (augmentedOperators.has(cursor.peek().text)) {
    validateSingleTarget(value, cursor);
    const operator = cursor.take().text.slice(0, -1);
    const rhs = readStatementValue(cursor);
    return { kind: "augmented-assignment", target: value, operator, value: rhs, start: first.start, end: rhs.end };
  }
  const targets: Expression[] = [];
  while (cursor.peek().text === "=") {
    validateTarget(value, cursor);
    targets.push(value);
    cursor.take();
    value = readStatementValue(cursor);
  }
  return targets.length
    ? { kind: "assignment", targets, value, start: first.start, end: value.end }
    : { kind: "expression-statement", expression: value, start: first.start, end: value.end };
}

function validateSingleTarget(target: Expression, cursor: TokenCursor): void {
  if (target.kind !== "name" && target.kind !== "attribute" && target.kind !== "subscript") {
    throw cursor.error("expected a single assignment target");
  }
  validateTarget(target, cursor);
}

function readStatementValue(cursor: TokenCursor): Expression {
  if (cursor.peek().text === "yield") return readYield(cursor, readExpression);
  const items: CollectionItem[] = [];
  let comma = false;
  let end = cursor.peek().end;
  do {
    if (cursor.peek().text === "*") {
      const start = cursor.take().start;
      const value = readExpression(cursor, 6);
      items.push({ kind: "unpack", value, start, end: value.end });
    } else items.push(readExpression(cursor));
    end = items[items.length - 1].end;
    if (cursor.peek().text !== ",") break;
    comma = true;
    end = cursor.take().end;
  } while (cursor.peek().kind !== "newline" && cursor.peek().kind !== "end" && ![";", "=", ":"].includes(cursor.peek().text));
  if (comma) return { kind: "tuple", items, start: items[0].start, end };
  const first = items[0];
  if (first.kind === "unpack") throw cursor.error("starred expression must be in a list or tuple");
  return first;
}
