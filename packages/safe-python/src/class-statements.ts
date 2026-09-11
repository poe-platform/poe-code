import type { CallArgument, Expression } from "./ast.js";
import type { Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readArguments } from "./primary.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";
import { readIgnoredTypeParameters } from "./type-parameters.js";

export function readClass(cursor: TokenCursor, readSuite: (cursor: TokenCursor) => Statement[], decorators: readonly Expression[] | undefined = undefined): Statement {
  try {
  cursor.meter?.checkpoint(1,192);
  if(decorators===undefined){cursor.meter?.checkpoint(0,32);decorators=[];}
  const opening = cursor.expect("class");
  const token = cursor.peek();
  if (token.kind !== "name" || reservedWords.has(token.text)) throw cursor.error("expected class name");
  const name = normalizeNfkc(token.text,cursor.meter);
  if (name === "__debug__") throw cursor.error("cannot assign to __debug__");
  cursor.take();
  if (cursor.peek().text === "[") readIgnoredTypeParameters(cursor);
  let args: CallArgument[] = [];
  if (cursor.peek().text === "(") {
    const opening = cursor.take();
    args = readArguments(cursor, readExpression, opening, false);
    cursor.expect(")");
  }
  const body = readSuite(cursor);
  return { kind: "class", name: { name, spelling: token.text, start: token.start, end: token.end },
    arguments: args, decorators, body, start: opening.start, end: body[body.length - 1]!.end };
  } finally {cursor.meter?.checkpoint();}
}
