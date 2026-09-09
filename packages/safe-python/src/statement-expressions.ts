import type { Expression } from "./ast.js";
import type { Statement } from "./statement-ast.js";

/** Enumerate executable expressions; discarded annotations are never visited. */
export function* statementExpressions(statement: Statement): Generator<Expression> {
  switch (statement.kind) {
    case "if":
      for (const branch of statement.branches) {
        yield branch.condition;
        for (const child of branch.body) yield* statementExpressions(child);
      }
      for (const child of statement.otherwise) yield* statementExpressions(child);
      return;
    case "while":
      yield statement.condition;
      for (const child of statement.body) yield* statementExpressions(child);
      for (const child of statement.otherwise) yield* statementExpressions(child);
      return;
    case "pass": case "break": case "continue": case "global": case "nonlocal": return;
    case "import": case "import-from": return;
    case "delete": yield* statement.targets; return;
    case "expression-statement": yield statement.expression; return;
    case "return": if (statement.value) yield statement.value; return;
    case "raise":
      if (statement.exception) yield statement.exception;
      if (statement.cause) yield statement.cause;
      return;
    case "assert":
      yield statement.condition;
      if (statement.message) yield statement.message;
      return;
    case "assignment": yield statement.value; yield* statement.targets; return;
    case "augmented-assignment": yield statement.target; yield statement.value; return;
    case "annotated-assignment":
      if (statement.value) yield statement.value;
      yield statement.target;
      return;
    default: { const exhaustive: never = statement; throw new Error(`unknown statement: ${exhaustive}`); }
  }
}
