import type { CollectionItem, Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";

/** Read the comma-separated assignment targets preceding a for-clause's `in`. */
export function readLoopTarget(cursor: TokenCursor, read: (cursor: TokenCursor, minimum?: number) => Expression): Expression {
  const items: CollectionItem[] = [];
  let comma = false;
  let end = cursor.peek().end;
  do {
    if (cursor.peek().text === "*") {
      const start = cursor.take().start;
      const value = read(cursor, 6);
      items.push({ kind: "unpack", value, start, end: value.end });
    } else items.push(read(cursor, 6));
    end = items[items.length - 1].end;
    if (cursor.peek().text !== ",") break;
    comma = true;
    end = cursor.take().end;
  } while (cursor.peek().text !== "in");
  const target: CollectionItem = comma ? { kind: "tuple", items, start: items[0].start, end } : items[0];
  if (target.kind === "unpack") throw cursor.error("starred assignment target must be in a list or tuple");
  validateTarget(target, cursor);
  return target;
}

function validateTarget(target: Expression, cursor: TokenCursor): void {
  if ((target.kind === "name" || target.kind === "attribute") && target.spelling === "__debug__") {
    throw cursor.error("cannot assign to __debug__");
  }
  if (target.kind === "name" || target.kind === "attribute" || target.kind === "subscript") return;
  if (target.kind !== "tuple" && target.kind !== "list") throw cursor.error("cannot assign to expression");
  let starred = false;
  for (const item of target.items) {
    if (item.kind === "unpack") {
      if (starred) throw cursor.error("multiple starred expressions in assignment");
      starred = true;
      validateTarget(item.value, cursor);
    } else validateTarget(item, cursor);
  }
}
