import type { Expression } from "./ast.js";
import { expressionChildren } from "./expression-children.js";
import { PythonSyntaxError } from "./source.js";

export type ExpressionScope = {
  kind: "module" | "class" | "function" | "async-function" | "comprehension" | "async-comprehension";
  generator: boolean;
};

/** Check lexical expression placement and record yields in their owning scope. */
export function validateExpressionContext(expression: Expression, scope: ExpressionScope, filename: string): void {
  const asynchronous = scope.kind === "async-function" || scope.kind === "async-comprehension";
  if (expression.kind === "lambda") {
    for (const parameter of expression.parameters) if (parameter.default) validateExpressionContext(parameter.default, scope, filename);
    validateExpressionContext(expression.body, { kind: "function", generator: false }, filename);
    return;
  }
  if (expression.kind === "comprehension" || expression.kind === "dictionary-comprehension") {
    const generator = expression.kind === "comprehension" && expression.collection === "generator";
    const inner: ExpressionScope = { kind: generator || asynchronous ? "async-comprehension" : "comprehension", generator: false };
    for (let index = 0; index < expression.clauses.length; index++) {
      const clause = expression.clauses[index]!;
      if (clause.async && !generator && !asynchronous) throw new PythonSyntaxError("asynchronous comprehension outside of an asynchronous function", filename, clause.start);
      validateExpressionContext(clause.iterable, index === 0 ? scope : inner, filename);
      validateExpressionContext(clause.target, inner, filename);
      for (const filter of clause.filters) validateExpressionContext(filter, inner, filename);
    }
    if (expression.kind === "comprehension") validateExpressionContext(expression.element, inner, filename);
    else { validateExpressionContext(expression.key, inner, filename); validateExpressionContext(expression.value, inner, filename); }
    return;
  }
  if (expression.kind === "await" && !asynchronous) throw new PythonSyntaxError("'await' outside async function", filename, expression.start);
  if (expression.kind === "yield" || expression.kind === "yield-from") {
    if (scope.kind !== "function" && scope.kind !== "async-function") throw new PythonSyntaxError("'yield' outside function or inside comprehension", filename, expression.start);
    if (expression.kind === "yield-from" && asynchronous) throw new PythonSyntaxError("'yield from' inside async function", filename, expression.start);
    scope.generator = true;
  }
  for (const child of expressionChildren(expression)) validateExpressionContext(child, scope, filename);
}
