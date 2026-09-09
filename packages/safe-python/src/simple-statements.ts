import type { Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readAssignmentOrExpression, readStatementValue } from "./assignment-statements.js";
import { readExpression } from "./expression.js";

export function readSimpleStatement(cursor: TokenCursor): Statement {
  const token = cursor.peek();
  switch (token.text) {
    case "pass": case "break": case "continue":
      cursor.take();
      return { kind: token.text, start: token.start, end: token.end };
    case "return": {
      cursor.take();
      if (cursor.peek().text === "yield") throw cursor.error("yield in return value must be parenthesized");
      const value = atStatementEnd(cursor) ? null : readStatementValue(cursor);
      return { kind: "return", value, start: token.start, end: value?.end ?? token.end };
    }
    case "raise": {
      cursor.take();
      const exception = atStatementEnd(cursor) ? null : readExpression(cursor);
      let cause = null;
      if (exception && cursor.peek().text === "from") { cursor.take(); cause = readExpression(cursor); }
      return { kind: "raise", exception, cause, start: token.start, end: cause?.end ?? exception?.end ?? token.end };
    }
    case "assert": {
      cursor.take();
      const condition = readExpression(cursor);
      let message = null;
      if (cursor.peek().text === ",") { cursor.take(); message = readExpression(cursor); }
      return { kind: "assert", condition, message, start: token.start, end: message?.end ?? condition.end };
    }
    default: return readAssignmentOrExpression(cursor);
  }
}

function atStatementEnd(cursor: TokenCursor): boolean {
  const token = cursor.peek();
  return token.kind === "newline" || token.kind === "end" || token.text === ";";
}
