import { validateExpressionContext } from "./expression-context.js";
import type { Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readTypeParameters } from "./type-parameters.js";
import { validateExpression } from "./expression-validation.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";

/** Recognize the soft-keyword prefix, then retain the alias's deferred value. */
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
  const typeParameters = cursor.peek().text === "[" ? readTypeParameters(cursor) : undefined;
  cursor.expect("=");
  const value = readExpression(cursor);
  validateExpression(value, cursor.filename, {iterations:new Set(), iterable:false, target:false, assignments:null,
    typeScope:"type alias"}, cursor.meter);
  validateExpressionContext(value, {kind:"function", generator:false}, cursor.filename, undefined, cursor.meter);
  return { kind: "type-alias", name: { name, spelling: token.text, start: token.start, end: token.end },
    ...(typeParameters === undefined ? {} : { typeParameters }), value, start, end: value.end };
  } finally {cursor.meter?.checkpoint();}
}
