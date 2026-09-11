import type { SourcePosition } from "./source.js";
import type { Statement, WithItem } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { validateTarget } from "./targets.js";

export function readWith(cursor: TokenCursor, readSuite: (cursor: TokenCursor) => Statement[], asyncStart?: SourcePosition): Statement {
  try {
  cursor.meter?.checkpoint(1,160);
  const opening = cursor.expect("with");
  // Python tries the parenthesized manager-list grammar before ordinary expressions.
  const parenthesized = cursor.peek().text === "(" ? cursor.attempt(() => {
    cursor.take();
    const items = readItems(cursor, true);
    cursor.expect(")");
    if (cursor.peek().text !== ":") throw cursor.error("expected ':'");
    return items;
  }) : undefined;
  const items = parenthesized ?? readItems(cursor, false);
  const body = readSuite(cursor);
  return { kind: "with", async: asyncStart !== undefined, items, body, start: asyncStart ?? opening.start, end: body[body.length - 1]!.end };
  } finally {cursor.meter?.checkpoint();}
}

function readItems(cursor: TokenCursor, parenthesized: boolean): WithItem[] {
  cursor.meter?.checkpoint(1,32);
  const items: WithItem[] = [];
  for (;;) {
    const context = readExpression(cursor);
    let target = null;
    if (cursor.peek().text === "as") {
      cursor.take();
      target = readExpression(cursor);
      validateTarget(target, cursor);
    }
    cursor.meter?.checkpoint(1,72);
    items.push({ context, target, start: context.start, end: target?.end ?? context.end });
    if (cursor.peek().text !== ",") break;
    cursor.take();
    if (parenthesized && cursor.peek().text === ")") break;
  }
  return items;
}
