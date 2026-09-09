import type { Statement } from "./statement-ast.js";

/** Direct nested statements, without expressions or implicit scope traversal. */
export function* statementChildren(statement: Statement): Generator<Statement> {
  switch (statement.kind) {
    case "function": case "class": case "with": yield* statement.body; return;
    case "for": case "while": yield* statement.body; yield* statement.otherwise; return;
    case "if":
      for (const branch of statement.branches) yield* branch.body;
      yield* statement.otherwise; return;
    case "try":
      yield* statement.body;
      for (const handler of statement.handlers) yield* handler.body;
      yield* statement.otherwise; yield* statement.finalizer; return;
    case "match": for (const clause of statement.cases) yield* clause.body; return;
    case "type-alias": case "pass": case "break": case "continue": case "return": case "raise":
    case "assert": case "global": case "nonlocal": case "delete": case "import": case "import-from":
    case "expression-statement": case "assignment": case "augmented-assignment": case "annotated-assignment": return;
    default: { const exhaustive: never = statement; throw new Error(`unknown statement: ${exhaustive}`); }
  }
}
