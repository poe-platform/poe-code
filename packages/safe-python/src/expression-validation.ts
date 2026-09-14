import type { Expression } from "./ast.js";
import { expressionChildren } from "./expression-children.js";
import { PythonSyntaxError,type SourceMeter } from "./source.js";

interface Context {
  readonly iterations: Set<string>;
  readonly iterable: boolean;
  readonly target: boolean;
  readonly assignments: Set<string> | null;
  readonly targetReferences?: Set<string>;
  readonly comprehension?: string;
  readonly typeScope?: string;
}

/** Validate expression-level scope constraints without host recursion. Pending
 * contexts share their mutable scope sets, retaining left-to-right checks. */
export function validateExpression(node: Expression, filename = "<string>", context?:Context,meter?:SourceMeter): void {
  meter?.checkpoint(1,160);
  context??={iterations:new Set(),iterable:false,target:false,assignments:null};
  const pending:{node:Expression;context:Context}[]=[{node,context}];
  while(pending.length) {
    meter?.checkpoint();
    const {node,context}=pending.pop()!;
    if (context.typeScope && !context.comprehension &&
        (node.kind === "assignment-expression" || node.kind === "yield" || node.kind === "yield-from" || node.kind === "await")) {
      const kind = node.kind === "assignment-expression" ? "named" : node.kind === "await" ? "await" : "yield";
      const message = `${kind} expression cannot be used within ${context.typeScope === "annotation" ? "an annotation" : `a ${context.typeScope}`}`;
      const span = node.contentSpan ?? node;
      meter?.checkpoint(0,320+2*message.length);
      throw new PythonSyntaxError(message, filename, span.start, span.end);
    }
    if ((node.kind === "yield" || node.kind === "yield-from") && context.comprehension) {
      const message = `'yield' inside ${context.comprehension}`;
      const span = node.contentSpan ?? node;
      meter?.checkpoint(0,320+2*message.length);
      throw new PythonSyntaxError(message, filename, span.start, span.end);
    }
    if (node.kind === "name" && context.target && context.assignments?.has(node.name)) {
      meter?.checkpoint(0,288+2*node.name.length);
      throw new PythonSyntaxError(`comprehension inner loop cannot rebind assignment expression target '${node.name}'`, filename, node.start);
    }
    if (node.kind === "name" && context.target && context.targetReferences) addName(context.targetReferences,node.name,meter);
    if (node.kind === "assignment-expression") {
      if (context.iterable) {
        meter?.checkpoint(0,288);
        throw new PythonSyntaxError("assignment expression cannot be used in a comprehension iterable expression", filename, node.target.start);
      }
      if (context.iterations.has(node.target.name)) {
        meter?.checkpoint(0,288+2*node.target.name.length);
        throw new PythonSyntaxError(`assignment expression cannot rebind comprehension iteration variable '${node.target.name}'`, filename, node.target.start, node.target.end);
      }
      if (context.typeScope && context.typeScope !== "annotation" && context.comprehension) {
        const scope = context.typeScope === "type alias" ? "type alias" : "TypeVar bound";
        const message = `assignment expression within a comprehension cannot be used in a ${scope}`;
        meter?.checkpoint(0,320+2*message.length);
        throw new PythonSyntaxError(message, filename, node.target.start, node.target.end);
      }
      if(context.assignments)addName(context.assignments,node.target.name,meter);
      // A first assignment makes a referenced target name a local definition.
      if (context.targetReferences?.has(node.target.name)) addName(context.iterations,node.target.name,meter);
    }
    if (node.kind === "lambda") {
      meter?.checkpoint(0,144);
      pending.push({node:node.body,context:{iterations:new Set(),iterable:context.iterable,target:false,assignments:null}});
      for(let index=node.parameters.length-1;index>=0;index--) {
        meter?.checkpoint();
        const value=node.parameters[index].default;
        if(value!==null){meter?.checkpoint(0,40);pending.push({node:value,context});}
      }
      continue;
    }
    if (node.kind === "comprehension" || node.kind === "dictionary-comprehension") {
      meter?.checkpoint(1+context.iterations.size,192+32*context.iterations.size);
      const iterations = new Set(context.iterations);
      for (const clause of node.clauses) {meter?.checkpoint();collectBindings(clause.target, iterations,meter);}
      const inner = { iterations, iterable: context.iterable, target: false, assignments: new Set<string>(), targetReferences: new Set<string>(), comprehension: node.kind === "dictionary-comprehension" ? "dict comprehension" : node.collection === "generator" ? "generator expression" : `${node.collection} comprehension`, typeScope: context.typeScope };
      if(node.kind==="comprehension"){meter?.checkpoint(0,40);pending.push({node:node.element,context:inner});}
      else {meter?.checkpoint(0,80);pending.push({node:node.value,context:inner},{node:node.key,context:inner});}
      for(let index=node.clauses.length-1;index>=0;index--) {
        meter?.checkpoint(1,192);
        const clause=node.clauses[index];
        for(let filter=clause.filters.length-1;filter>=0;filter--){meter?.checkpoint(1,40);pending.push({node:clause.filters[filter],context:inner});}
        pending.push({node:clause.target,context:{...inner,target:true}});
        // The first iterable belongs to the enclosing scope.
        pending.push({node:clause.iterable,context:{...(index===0?context:inner),iterable:true}});
      }
      continue;
    }
    meter?.checkpoint(0,32);const children:Expression[]=[];
    for(const child of expressionChildren(node,meter)){meter?.checkpoint(1,8);children.push(child);}
    for(let index=children.length-1;index>=0;index--){meter?.checkpoint(1,40);pending.push({node:children[index],context});}
  }
}

function addName(names:Set<string>,name:string,meter?:SourceMeter):void {
  meter?.checkpoint(1+name.length);
  if(names.has(name))return;
  meter?.checkpoint(0,32);names.add(name);
}

function collectBindings(target: Expression, names: Set<string>,meter?:SourceMeter): void {
  meter?.checkpoint(1,40);
  const pending=[target];
  while(pending.length) {
    meter?.checkpoint();
    const target=pending.pop()!;
    if(target.kind==="name")addName(names,target.name,meter);
    else if(target.kind==="tuple"||target.kind==="list") {
      for(let index=target.items.length-1;index>=0;index--) {
        meter?.checkpoint(1,8);
        const item=target.items[index];pending.push(item.kind==="unpack"?item.value:item);
      }
    }
  }
}
