import type { Expression } from "./ast.js";
import { expressionChildren } from "./expression-children.js";
import { PythonSyntaxError } from "./source.js";

interface Context {
  readonly iterations: Set<string>;
  readonly iterable: boolean;
  readonly target: boolean;
  readonly assignments: Set<string> | null;
  readonly targetReferences?: Set<string>;
  readonly comprehension?: boolean;
}

/** Validate expression-level scope constraints without executing any syntax. */
export function validateExpression(node: Expression, filename = "<string>", context: Context = { iterations: new Set(), iterable: false, target: false, assignments: null }): void {
  if ((node.kind === "yield" || node.kind === "yield-from") && context.comprehension) {
    throw new PythonSyntaxError("yield is not allowed inside a comprehension scope", filename, node.start);
  }
  if (node.kind === "name" && context.target && context.assignments?.has(node.name)) {
    throw new PythonSyntaxError(`comprehension inner loop cannot rebind assignment expression target '${node.name}'`, filename, node.start);
  }
  if (node.kind === "name" && context.target) context.targetReferences?.add(node.name);
  if (node.kind === "assignment-expression") {
    if (context.iterable) {
      throw new PythonSyntaxError("assignment expression cannot be used in a comprehension iterable expression", filename, node.target.start);
    }
    if (context.iterations.has(node.target.name)) {
      throw new PythonSyntaxError(`assignment expression cannot rebind comprehension iteration variable '${node.target.name}'`, filename, node.target.start);
    }
    context.assignments?.add(node.target.name);
    // CPython records a local definition after the first assignment, even when
    // the loop target only read this name through an attribute/subscript object.
    if (context.targetReferences?.has(node.target.name)) context.iterations.add(node.target.name);
  }
  if (node.kind === "lambda") {
    for (const parameter of node.parameters) if (parameter.default) validateExpression(parameter.default, filename, context);
    validateExpression(node.body, filename, { iterations: new Set(), iterable: context.iterable, target: false, assignments: null });
    return;
  }
  if (node.kind === "comprehension" || node.kind === "dictionary-comprehension") {
    const iterations = new Set(context.iterations);
    for (const clause of node.clauses) collectBindings(clause.target, iterations);
    const inner = { iterations, iterable: context.iterable, target: false, assignments: new Set<string>(), targetReferences: new Set<string>(), comprehension: true };
    for (let index = 0; index < node.clauses.length; index++) {
      const clause = node.clauses[index];
      // The first iterable is evaluated by the enclosing scope, not the
      // comprehension's implicit function; later iterables run inside it.
      validateExpression(clause.iterable, filename, { ...(index === 0 ? context : inner), iterable: true });
      validateExpression(clause.target, filename, { ...inner, target: true });
      for (const filter of clause.filters) validateExpression(filter, filename, inner);
    }
    if (node.kind === "comprehension") validateExpression(node.element, filename, inner);
    else { validateExpression(node.key, filename, inner); validateExpression(node.value, filename, inner); }
    return;
  }
  for (const child of expressionChildren(node)) validateExpression(child, filename, context);
}

function collectBindings(target: Expression, names: Set<string>): void {
  if (target.kind === "name") names.add(target.name);
  else if (target.kind === "tuple" || target.kind === "list") {
    for (const item of target.items) collectBindings(item.kind === "unpack" ? item.value : item, names);
  }
}
