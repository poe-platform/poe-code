import type { Expression } from "./ast.js";
import type { SourcePosition } from "./source.js";
import type { Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readParameters } from "./parameters.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";
import { readIgnoredTypeParameters } from "./type-parameters.js";

export function readFunction(cursor: TokenCursor, readSuite: (cursor: TokenCursor) => Statement[], asyncStart?: SourcePosition, decorators: readonly Expression[] | undefined = undefined): Statement {
  try {
  cursor.meter?.checkpoint(1,160);
  if(decorators===undefined){cursor.meter?.checkpoint(0,32);decorators=[];}
  const opening = cursor.expect("def");
  const token = cursor.peek();
  if (token.kind !== "name" || reservedWords.has(token.text)) throw cursor.error("expected function name");
  const name = normalizeNfkc(token.text,cursor.meter);
  if (name === "__debug__") throw cursor.error("cannot assign to __debug__");
  cursor.take();
  if (cursor.peek().text === "[") readIgnoredTypeParameters(cursor);
  cursor.expect("(");
  const parameters = readParameters(cursor, readExpression, ")");
  if (cursor.peek().text === "->") { cursor.take(); readExpression(cursor); }
  const body = readSuite(cursor);
  return { kind: "function", name: { name, spelling: token.text, start: token.start, end: token.end },
    async: asyncStart !== undefined, decorators, parameters, body, start: asyncStart ?? opening.start, end: body[body.length - 1]!.end };
  } finally {cursor.meter?.checkpoint();}
}
