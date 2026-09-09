import type { LexerOptions } from "./lexer.js";
import type { Module } from "./statement-ast.js";
import { createTokenCursor } from "./token-cursor.js";
import { readStatements } from "./compound-statements.js";
import { statementExpressions } from "./statement-expressions.js";
import { validateExpression } from "./expression-validation.js";

/** Parse module statements. Compound and remaining simple statements are in progress. */
export function parseModule(text: string, options: LexerOptions = {}): Module {
  const cursor = createTokenCursor(text, options);
  const start = cursor.peek().start;
  const body = readStatements(cursor);
  if (cursor.peek().kind !== "end") throw cursor.error("unexpected dedent");
  for (const statement of body) {
    for (const expression of statementExpressions(statement)) validateExpression(expression, options.filename);
  }
  return { kind: "module", body, start, end: cursor.peek().end };
}
