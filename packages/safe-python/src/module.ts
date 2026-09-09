import type { LexerOptions } from "./lexer.js";
import type { Module, Statement } from "./statement-ast.js";
import { createTokenCursor } from "./token-cursor.js";
import { readAssignmentOrExpression } from "./assignment-statements.js";
import { validateExpression } from "./expression-validation.js";

/** Parse module statements. Compound and remaining simple statements are in progress. */
export function parseModule(text: string, options: LexerOptions = {}): Module {
  const cursor = createTokenCursor(text, options);
  const start = cursor.peek().start;
  const body: Statement[] = [];
  while (cursor.peek().kind !== "end") {
    if (cursor.peek().kind === "newline") { cursor.take(); continue; }
    const token = cursor.peek();
    let statement: Statement;
    if (token.text === "pass") {
      cursor.take();
      statement = { kind: "pass", start: token.start, end: token.end };
    } else statement = readAssignmentOrExpression(cursor);
    body.push(statement);
    if (cursor.peek().text === ";") { cursor.take(); continue; }
    if (cursor.peek().kind !== "newline" && cursor.peek().kind !== "end") throw cursor.error("expected newline or ';'");
  }
  for (const statement of body) {
    if (statement.kind === "expression-statement") validateExpression(statement.expression, options.filename);
    else if (statement.kind !== "pass") {
      const targets = statement.kind === "assignment" ? statement.targets : [statement.target];
      for (const target of targets) validateExpression(target, options.filename);
      if (statement.value) validateExpression(statement.value, options.filename);
    }
  }
  return { kind: "module", body, start, end: cursor.peek().end };
}
