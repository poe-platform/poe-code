import type { Module, Statement } from "./statement-ast.js";
import { PythonSyntaxError } from "./source.js";

type Context = {
  scope: "module" | "class" | "function" | "async-function";
  loops: number;
  exceptStarLoop: number | null;
};

/** Statement placement checks, separate from parsing and expression/symbol analysis. */
export function validateControlFlow(module: Module, filename = "<string>"): void {
  function visit(statements: readonly Statement[], context: Context): void {
    for (const statement of statements) {
      const invalid = (message: string): PythonSyntaxError => new PythonSyntaxError(message, filename, statement.start);
      switch (statement.kind) {
        case "return":
          if (context.scope !== "function" && context.scope !== "async-function") throw invalid("'return' outside function");
          if (context.exceptStarLoop !== null) throw invalid("'return' cannot leave an except* block");
          break;
        case "break": case "continue":
          if (!context.loops) throw invalid(`'${statement.kind}' outside loop`);
          if (context.exceptStarLoop !== null && context.loops <= context.exceptStarLoop) throw invalid(`'${statement.kind}' cannot leave an except* block`);
          break;
        case "function":
          visit(statement.body, { scope: statement.async ? "async-function" : "function", loops: 0, exceptStarLoop: null });
          break;
        case "class":
          visit(statement.body, { scope: "class", loops: 0, exceptStarLoop: null });
          break;
        case "for":
          if (statement.async && context.scope !== "async-function") throw invalid("'async for' outside async function");
          visit(statement.body, { ...context, loops: context.loops + 1 });
          visit(statement.otherwise, context);
          break;
        case "while":
          visit(statement.body, { ...context, loops: context.loops + 1 });
          visit(statement.otherwise, context);
          break;
        case "with":
          if (statement.async && context.scope !== "async-function") throw invalid("'async with' outside async function");
          visit(statement.body, context);
          break;
        case "if":
          for (const branch of statement.branches) visit(branch.body, context);
          visit(statement.otherwise, context);
          break;
        case "match":
          for (const clause of statement.cases) visit(clause.body, context);
          break;
        case "try":
          visit(statement.body, context);
          for (const handler of statement.handlers) {
            visit(handler.body, statement.group ? { ...context, exceptStarLoop: context.loops } : context);
          }
          visit(statement.otherwise, context);
          visit(statement.finalizer, context);
          break;
        case "import-from":
          if (statement.imports === "*" && context.scope !== "module") throw invalid("import * only allowed at module level");
          break;
        case "pass": case "type-alias": case "raise": case "assert": case "global": case "nonlocal":
        case "delete": case "import": case "expression-statement": case "assignment":
        case "augmented-assignment": case "annotated-assignment": break;
        default: { const exhaustive: never = statement; throw new Error(`unknown statement: ${exhaustive}`); }
      }
    }
  }
  visit(module.body, { scope: "module", loops: 0, exceptStarLoop: null });
}
