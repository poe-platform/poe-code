import type { Module, Statement } from "./statement-ast.js";
import { PythonSyntaxError, type SourceMeter } from "./source.js";
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
export function validateControlFlow(module: Module, filename = "<string>",meter?:SourceMeter): ReadonlyMap<FunctionNode, FunctionExecutionKind> {
  meter?.checkpoint(1,64);
  try {
  const functionKinds = new Map<FunctionNode, FunctionExecutionKind>();
  function* visit(statements: readonly Statement[], context: Context): Generator<{statements:readonly Statement[];context:Context}> {
    for (const statement of statements) {
      meter?.checkpoint(1,128);
      const expressions = statement.kind === "annotated-assignment" && statement.value === null
        ? annotationTargetExpressions(statement.target, filename,meter) : statementExpressions(statement, false,meter);
      for (const expression of expressions) validateExpressionContext(expression, context.scope, filename, functionKinds,meter);
      meter?.checkpoint(0,64);
      const invalid = (message: string): PythonSyntaxError => {meter?.checkpoint(0,256+2*message.length);return new PythonSyntaxError(message, filename, statement.start);};
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
          meter?.checkpoint(0,144);
          const scope: Scope = { kind: statement.async ? "async-function" : "function", generator: false };
          yield {statements:statement.body,context:{ scope, loops: 0, exceptStarLoop: null }};
          if (statement.async && scope.generator && scope.valueReturn) {meter?.checkpoint(0,352);throw new PythonSyntaxError("'return' with value in async generator", filename, scope.valueReturn.start);}
          if(!functionKinds.has(statement))meter?.checkpoint(0,32);
          functionKinds.set(statement, statement.async
            ? scope.generator ? "async-generator" : "coroutine"
            : scope.generator ? "generator" : "function");
          break;
        }
        case "class":
          meter?.checkpoint(0,144);yield {statements:statement.body,context:{ scope: { kind: "class", generator: false }, loops: 0, exceptStarLoop: null }};
          break;
        case "for":
          if (statement.async && context.scope.kind !== "async-function") throw invalid("'async for' outside async function");
          meter?.checkpoint(0,96);yield {statements:statement.body,context:{ ...context, loops: context.loops + 1 }};
          meter?.checkpoint(0,48);yield {statements:statement.otherwise,context};
          break;
        case "while":
          meter?.checkpoint(0,96);yield {statements:statement.body,context:{ ...context, loops: context.loops + 1 }};
          meter?.checkpoint(0,48);yield {statements:statement.otherwise,context};
          break;
        case "with":
          if (statement.async && context.scope.kind !== "async-function") throw invalid("'async with' outside async function");
          meter?.checkpoint(0,48);yield {statements:statement.body,context};
          break;
        case "if":
          for (const branch of statement.branches) {meter?.checkpoint(1,48);yield {statements:branch.body,context};}
          meter?.checkpoint(0,48);yield {statements:statement.otherwise,context};
          break;
        case "match":
          for (const clause of statement.cases) {meter?.checkpoint(1,48);yield {statements:clause.body,context};}
          break;
        case "try":
          meter?.checkpoint(0,48);yield {statements:statement.body,context};
          for (const handler of statement.handlers) {
            meter?.checkpoint(1,96);yield {statements:handler.body,context:statement.group ? { ...context, exceptStarLoop: context.loops } : context};
          }
          meter?.checkpoint(0,48);yield {statements:statement.otherwise,context};
          meter?.checkpoint(0,48);yield {statements:statement.finalizer,context};
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
  meter?.checkpoint(0,224);
  const pending=[visit(module.body, { scope: { kind: "module", generator: false }, loops: 0, exceptStarLoop: null })];
  while(pending.length){
    meter?.checkpoint(1,32);const next=pending[pending.length-1].next();
    if(next.done){pending.pop();continue;}
    meter?.checkpoint(0,128);pending.push(visit(next.value.statements,next.value.context));
  }
  return functionKinds;
  } finally {meter?.checkpoint();}
}
