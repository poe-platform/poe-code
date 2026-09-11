import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";

/** Consume type syntax without introducing executable expressions or bindings. */
export function readIgnoredTypeParameters(cursor: TokenCursor): void {
  try {
  cursor.meter?.checkpoint(1,64);
  cursor.expect("[");
  const names = new Set<string>();
  let defaultSeen = false;
  for (;;) {
    let prefix = "";
    if (cursor.peek().text === "*" || cursor.peek().text === "**") prefix = cursor.take().text;
    const token = cursor.peek();
    if (token.kind !== "name" || reservedWords.has(token.text)) throw cursor.error("expected type parameter name");
    const name = normalizeNfkc(token.text,cursor.meter);
    if (name === "__debug__") throw cursor.error("cannot assign to __debug__");
    cursor.meter?.checkpoint(1+name.length);
    if (names.has(name)) {
      cursor.meter?.checkpoint(0,96+2*name.length);
      throw cursor.error(`duplicate type parameter '${name}'`);
    }
    cursor.meter?.checkpoint(0,32);
    names.add(name);
    cursor.take();
    if (cursor.peek().text === ":") {
      if (prefix) throw cursor.error("variadic type parameters cannot have bounds");
      cursor.take();
      readExpression(cursor);
    }
    if (cursor.peek().text === "=") {
      cursor.take();
      defaultSeen = true;
      const starred = prefix === "*" && cursor.peek().text === "*";
      if (starred) cursor.take();
      readExpression(cursor, starred ? 6 : undefined);
    } else if (defaultSeen) {
      cursor.meter?.checkpoint(0,160+2*name.length);
      throw cursor.error(`non-default type parameter '${name}' follows default type parameter`);
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
    if (cursor.peek().text === "]") break;
  }
  cursor.expect("]");
  } finally {cursor.meter?.checkpoint();}
}
