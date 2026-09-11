import type { LexerOptions } from "./lexer.js";
import type { Module } from "./statement-ast.js";
import { createTokenCursor } from "./token-cursor.js";
import { readStatements } from "./compound-statements.js";
import { statementExpressions } from "./statement-expressions.js";
import { validateExpression } from "./expression-validation.js";
import { PythonSyntaxError } from "./source.js";

/** Parse module syntax; use analyzeModule to also validate contexts and resolve scopes. */
export function parseModule(text: string, options: LexerOptions = {}): Module {
  try {
    const cursor = createTokenCursor(text, options);
    const start = cursor.peek().start;
    const body = readStatements(cursor);
    if (cursor.peek().kind !== "end") throw cursor.error("unexpected dedent");
    for (const statement of body) {
      for (const expression of statementExpressions(statement,true,options.meter)) validateExpression(expression, options.filename,undefined,options.meter);
    }
    return { kind: "module", body, start, end: cursor.peek().end };
  } catch (error) {
    if (error instanceof PythonSyntaxError) error.withSource(text,false,options.meter);
    throw error;
  } finally {options.meter?.checkpoint();}
}
