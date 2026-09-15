import type { Expression } from "./ast.js";
import { expressionChildren } from "./expression-children.js";
import { PythonSyntaxError, type SourceMeter } from "./source.js";
import type { Statement } from "./statement-ast.js";

export type FunctionExecutionKind = "function" | "generator" | "coroutine" | "async-generator";
export type FunctionNode = Extract<Statement, { kind: "function" }> | Extract<Expression, { kind: "lambda" }>;

export type ExpressionScope = {
  kind: "module" | "class" | "function" | "async-function" | "comprehension" | "async-comprehension";
  generator: boolean;
  suspends?: boolean;
};

/** Check lexical expression placement and record yields in their owning scope. */
export function validateExpressionContext(
  expression: Expression, scope: ExpressionScope, filename: string,
  functionKinds?: Map<FunctionNode, FunctionExecutionKind>,meter?:SourceMeter
): void {
  meter?.checkpoint(1,160);
  const pending=[contextChildren(expression,scope,filename,functionKinds,meter)];
  try {
    while(pending.length){
      meter?.checkpoint(1,32);
      const next=pending[pending.length-1].next();
      if(next.done){pending.pop();continue;}
      meter?.checkpoint(0,128);
      pending.push(contextChildren(next.value.expression,next.value.scope,filename,functionKinds,meter));
    }
  } finally {meter?.checkpoint();}
}

/** Resuming after a child finishes preserves lambda scope finalization order. */
function* contextChildren(expression:Expression,scope:ExpressionScope,filename:string,functionKinds:Map<FunctionNode,FunctionExecutionKind>|undefined,meter:SourceMeter|undefined):Generator<{expression:Expression;scope:ExpressionScope}>{
  meter?.checkpoint();
  const asynchronous = scope.kind === "async-function" || scope.kind === "async-comprehension";
  if (expression.kind === "lambda") {
    for (const parameter of expression.parameters) {meter?.checkpoint();if (parameter.default) {meter?.checkpoint(0,48);yield {expression:parameter.default,scope};}}
    meter?.checkpoint(0,96);
    const inner: ExpressionScope = { kind: "function", generator: false };
    yield {expression:expression.body,scope:inner};
    if(functionKinds&&!functionKinds.has(expression))meter?.checkpoint(0,32);
    functionKinds?.set(expression, inner.generator ? "generator" : "function");
    return;
  }
  if (expression.kind === "comprehension" || expression.kind === "dictionary-comprehension") {
    const generator = expression.kind === "comprehension" && expression.collection === "generator";
    meter?.checkpoint(0,48);
    const inner: ExpressionScope = { kind: "async-comprehension", generator: false, suspends: false };
    for (let index = 0; index < expression.clauses.length; index++) {
      const clause = expression.clauses[index]!;
      meter?.checkpoint();
      if (clause.async) inner.suspends = true;
      meter?.checkpoint(0,48);yield {expression:clause.iterable,scope:index===0?scope:inner};
      meter?.checkpoint(0,48);yield {expression:clause.target,scope:inner};
      for (const filter of clause.filters) {meter?.checkpoint(1,48);yield {expression:filter,scope:inner};}
    }
    if (expression.kind === "comprehension") {meter?.checkpoint(0,48);yield {expression:expression.element,scope:inner};}
    else {meter?.checkpoint(0,48);yield {expression:expression.key,scope:inner};meter?.checkpoint(0,48);yield {expression:expression.value,scope:inner};}
    // Eager comprehensions suspend their parent; generator expressions defer
    // their body, so only their first iterable can suspend the enclosing scope.
    if (!generator && inner.suspends) {
      if (!asynchronous) {
        meter?.checkpoint(0,384);
        const span = expression.contentSpan ?? expression;
        throw new PythonSyntaxError("asynchronous comprehension outside of an asynchronous function", filename, span.start, span.end);
      }
      scope.suspends = true;
    }
    return;
  }
  if (expression.kind === "await") {
    if (!asynchronous) {
      meter?.checkpoint(0,320);
      const span = expression.contentSpan ?? expression;
      throw new PythonSyntaxError("'await' outside async function", filename, span.start, span.end);
    }
    scope.suspends = true;
  }
  if (expression.kind === "yield" || expression.kind === "yield-from") {
    if (scope.kind !== "function" && scope.kind !== "async-function") {meter?.checkpoint(0,352);throw new PythonSyntaxError("'yield' outside function or inside comprehension", filename, expression.start);}
    if (expression.kind === "yield-from" && asynchronous) {meter?.checkpoint(0,320);throw new PythonSyntaxError("'yield from' inside async function", filename, expression.start);}
    scope.generator = true;
  }
  meter?.checkpoint(0,128);
  for (const child of expressionChildren(expression,meter)) {meter?.checkpoint(1,48);yield {expression:child,scope};}
}
