import type { LexerOptions } from "./lexer.js";
import type { Module, Statement } from "./statement-ast.js";
import { createTokenCursor } from "./token-cursor.js";
import { readSimpleStatement } from "./simple-statements.js";
import { statementExpressions } from "./statement-expressions.js";
import { validateExpression } from "./expression-validation.js";

/** Parse module statements. Compound and remaining simple statements are in progress. */
export function parseModule(text: string, options: LexerOptions = {}): Module {
  const cursor = createTokenCursor(text, options);
  const start = cursor.peek().start;
  const body: Statement[] = [];
  while (cursor.peek().kind !== "end") {
    if (cursor.peek().kind === "newline") { cursor.take(); continue; }
    body.push(readSimpleStatement(cursor));
    if (cursor.peek().text === ";") { cursor.take(); continue; }
    if (cursor.peek().kind !== "newline" && cursor.peek().kind !== "end") throw cursor.error("expected newline or ';'");
  }
  for (const statement of body) {
    for (const expression of statementExpressions(statement)) validateExpression(expression, options.filename);
  }
  return { kind: "module", body, start, end: cursor.peek().end };
}
