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

/** Validate expression-level scope constraints without host recursion. Pending
 * contexts share their mutable scope sets, retaining left-to-right checks. */
export function validateExpression(node: Expression, filename = "<string>", context: Context = { iterations: new Set(), iterable: false, target: false, assignments: null }): void {
  const pending:{node:Expression;context:Context}[]=[{node,context}];
  while(pending.length) {
    const {node,context}=pending.pop()!;
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
      // A first assignment makes a referenced target name a local definition.
      if (context.targetReferences?.has(node.target.name)) context.iterations.add(node.target.name);
    }
    if (node.kind === "lambda") {
      pending.push({node:node.body,context:{iterations:new Set(),iterable:context.iterable,target:false,assignments:null}});
      for(let index=node.parameters.length-1;index>=0;index--) {
        const value=node.parameters[index].default;
        if(value!==null)pending.push({node:value,context});
      }
      continue;
    }
    if (node.kind === "comprehension" || node.kind === "dictionary-comprehension") {
      const iterations = new Set(context.iterations);
      for (const clause of node.clauses) collectBindings(clause.target, iterations);
      const inner = { iterations, iterable: context.iterable, target: false, assignments: new Set<string>(), targetReferences: new Set<string>(), comprehension: true };
      if(node.kind==="comprehension")pending.push({node:node.element,context:inner});
      else pending.push({node:node.value,context:inner},{node:node.key,context:inner});
      for(let index=node.clauses.length-1;index>=0;index--) {
        const clause=node.clauses[index];
        for(let filter=clause.filters.length-1;filter>=0;filter--)pending.push({node:clause.filters[filter],context:inner});
        pending.push({node:clause.target,context:{...inner,target:true}});
        // The first iterable belongs to the enclosing scope.
        pending.push({node:clause.iterable,context:{...(index===0?context:inner),iterable:true}});
      }
      continue;
    }
    const children=[...expressionChildren(node)];
    for(let index=children.length-1;index>=0;index--)pending.push({node:children[index],context});
  }
}

function collectBindings(target: Expression, names: Set<string>): void {
  const pending=[target];
  while(pending.length) {
    const target=pending.pop()!;
    if(target.kind==="name")names.add(target.name);
    else if(target.kind==="tuple"||target.kind==="list") {
      for(let index=target.items.length-1;index>=0;index--) {
        const item=target.items[index];pending.push(item.kind==="unpack"?item.value:item);
      }
    }
  }
}
