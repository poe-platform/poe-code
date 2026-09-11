import type { Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readIgnoredTypeParameters } from "./type-parameters.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";

/** Recognize the soft-keyword prefix, then discard the alias's type expressions. */
export function readTypeAlias(cursor: TokenCursor): Statement | undefined {
  try {
  cursor.meter?.checkpoint(1,64);
  const start = cursor.peek().start;
  const token = cursor.attempt(() => {
    cursor.expect("type");
    const name = cursor.peek();
    if (name.kind !== "name" || reservedWords.has(name.text)) throw cursor.error("expected type alias name");
    return cursor.take();
  });
  if (!token) return undefined;
  cursor.meter?.checkpoint(0,128);
  const name = normalizeNfkc(token.text,cursor.meter);
  if (name === "__debug__") throw cursor.error("cannot assign to __debug__");
  if (cursor.peek().text === "[") readIgnoredTypeParameters(cursor);
  cursor.expect("=");
  const value = readExpression(cursor);
  return { kind: "type-alias", name: { name, spelling: token.text, start: token.start, end: token.end }, start, end: value.end };
  } finally {cursor.meter?.checkpoint();}
}
