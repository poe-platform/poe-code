import type { CollectionItem, Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";

/** Yield is admitted by group, replacement-field, and statement grammar only. */
export function readYield(cursor: TokenCursor, read: (cursor: TokenCursor, minimum?: number) => Expression): Expression {
  const opening = cursor.expect("yield");
  if (cursor.peek().text === "from") {
    cursor.take();
    const value = read(cursor);
    return { kind: "yield-from", value, start: opening.start, end: value.end };
  }
  const items: CollectionItem[] = [];
  let comma = false;
  let end = opening.end;
  while (!endsYield(cursor)) {
    if (cursor.peek().text === "*") {
      const start = cursor.take().start;
      const value = read(cursor, 6);
      items.push({ kind: "unpack", value, start, end: value.end });
    } else items.push(read(cursor));
    end = items[items.length - 1].end;
    if (cursor.peek().text !== ",") break;
    comma = true;
    end = cursor.take().end;
  }
  let value: Expression | null = null;
  if (comma) value = { kind: "tuple", items, start: items[0].start, end };
  else if (items.length) {
    const first = items[0];
    if (first.kind === "unpack") throw cursor.error("cannot use starred expression here");
    value = first;
  }
  return { kind: "yield", value, start: opening.start, end };
}

function endsYield(cursor: TokenCursor): boolean {
  const token = cursor.peek();
  return token.kind === "newline" || token.kind === "end" || [")", "]", "}", ";", "=", "!", ":"].includes(token.text);
}
