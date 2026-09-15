import type { Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readParameters } from "./parameters.js";

export function readLambda(cursor: TokenCursor, read: (cursor: TokenCursor) => Expression): Expression {
  try {
  cursor.meter?.checkpoint();
  const start = cursor.expect("lambda").start;
  const parameters = readParameters(cursor, read, ":");
  const body = read(cursor);
  cursor.meter?.checkpoint(0,80);
  return { kind: "lambda", parameters, body, start, end: body.end };
  } finally {cursor.meter?.checkpoint();}
}
