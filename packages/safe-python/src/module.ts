import type { LexerOptions } from "./lexer.js";
import type { Module } from "./statement-ast.js";
import { createTokenCursor, type TokenCursor } from "./token-cursor.js";
import { readStatements } from "./compound-statements.js";
import { statementExpressions } from "./statement-expressions.js";
import { validateExpression } from "./expression-validation.js";
import { PythonSyntaxError } from "./source.js";

/** Parse module syntax; use analyzeModule to also validate contexts and resolve scopes. */
export function parseModule(text: string, options: LexerOptions = {}): Module {
  let cursor: TokenCursor | undefined;
  try {
    options.meter?.checkpoint(1,64);
    cursor = createTokenCursor(text, options);
    const start = cursor.peek().start;
    const body = readStatements(cursor);
    if (cursor.peek().kind !== "end") throw cursor.error("unexpected dedent");
    for (const statement of body) {
      options.meter?.checkpoint(1,128);
      for (const expression of statementExpressions(statement,true,options.meter)) validateExpression(expression, options.filename,undefined,options.meter);
    }
    return { kind: "module", body, start, end: cursor.peek().end };
  } catch (error) {
    const failure = error instanceof PythonSyntaxError && cursor !== undefined ? cursor.finishSyntaxError(error) : error;
    if (failure instanceof PythonSyntaxError) failure.withSource(text,false,options.meter);
    throw failure;
  } finally {options.meter?.checkpoint();}
}
