import type { Module, Statement } from "./statement-ast.js";
import { PythonSyntaxError } from "./source.js";
import { statementExpressions } from "./statement-expressions.js";
import { validateExpressionContext, type ExpressionScope, type FunctionNode, type FunctionExecutionKind } from "./expression-context.js";
import { annotationTargetExpressions } from "./annotation-targets.js";

type Scope = ExpressionScope & { valueReturn?: Statement };

type Context = {
  scope: Scope;
  loops: number;
  exceptStarLoop: number | null;
};

/** Statement and expression placement checks, separate from parsing and symbol analysis. */
export function validateControlFlow(module: Module, filename = "<string>"): ReadonlyMap<FunctionNode, FunctionExecutionKind> {
  const functionKinds = new Map<FunctionNode, FunctionExecutionKind>();
  function visit(statements: readonly Statement[], context: Context): void {
    for (const statement of statements) {
      const expressions = statement.kind === "annotated-assignment" && statement.value === null
        ? annotationTargetExpressions(statement.target, filename) : statementExpressions(statement, false);
      for (const expression of expressions) validateExpressionContext(expression, context.scope, filename, functionKinds);
      const invalid = (message: string): PythonSyntaxError => new PythonSyntaxError(message, filename, statement.start);
      switch (statement.kind) {
        case "return":
          if (context.scope.kind !== "function" && context.scope.kind !== "async-function") throw invalid("'return' outside function");
          if (context.exceptStarLoop !== null) throw invalid("'return' cannot leave an except* block");
          if (statement.value) context.scope.valueReturn = statement;
          break;
        case "break": case "continue":
          if (!context.loops) throw invalid(`'${statement.kind}' outside loop`);
          if (context.exceptStarLoop !== null && context.loops <= context.exceptStarLoop) throw invalid(`'${statement.kind}' cannot leave an except* block`);
          break;
        case "function": {
          const scope: Scope = { kind: statement.async ? "async-function" : "function", generator: false };
          visit(statement.body, { scope, loops: 0, exceptStarLoop: null });
          if (statement.async && scope.generator && scope.valueReturn) throw new PythonSyntaxError("'return' with value in async generator", filename, scope.valueReturn.start);
          functionKinds.set(statement, statement.async
            ? scope.generator ? "async-generator" : "coroutine"
            : scope.generator ? "generator" : "function");
          break;
        }
        case "class":
          visit(statement.body, { scope: { kind: "class", generator: false }, loops: 0, exceptStarLoop: null });
          break;
        case "for":
          if (statement.async && context.scope.kind !== "async-function") throw invalid("'async for' outside async function");
          visit(statement.body, { ...context, loops: context.loops + 1 });
          visit(statement.otherwise, context);
          break;
        case "while":
          visit(statement.body, { ...context, loops: context.loops + 1 });
          visit(statement.otherwise, context);
          break;
        case "with":
          if (statement.async && context.scope.kind !== "async-function") throw invalid("'async with' outside async function");
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
          if (statement.imports === "*" && context.scope.kind !== "module") throw invalid("import * only allowed at module level");
          break;
        case "pass": case "type-alias": case "raise": case "assert": case "global": case "nonlocal":
        case "delete": case "import": case "expression-statement": case "assignment":
        case "augmented-assignment": case "annotated-assignment": break;
        default: { const exhaustive: never = statement; throw new Error(`unknown statement: ${exhaustive}`); }
      }
    }
  }
  visit(module.body, { scope: { kind: "module", generator: false }, loops: 0, exceptStarLoop: null });
  return functionKinds;
}
