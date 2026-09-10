import type {Expression} from "../ast.js";
import {expressionChildren} from "../expression-children.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {ComprehensionNode} from "./comprehension-execution.js";

/** Classify work executed inside an implicit comprehension scope. The outer
 * source belongs to its caller; nested generator bodies and lambda bodies are
 * lazy scopes, unlike materialized comprehensions and lambda defaults. */
export function comprehensionIsAsynchronous(root:ComprehensionNode,meter:ExecutionMeter):boolean {
  meter.checkpoint(1,64);
  const pending:Expression[]=[root];
  const enqueue=(node:Expression)=>{meter.checkpoint(1,8);pending.push(node);};
  while(pending.length) {
    meter.checkpoint();
    const node=pending.pop()!;
    if(node.kind==="await")return true;
    if(node.kind==="lambda") {
      for(const parameter of node.parameters)if(parameter.default)enqueue(parameter.default);
      continue;
    }
    if(node.kind==="comprehension"||node.kind==="dictionary-comprehension") {
      if(node!==root)enqueue(node.clauses[0].iterable);
      if(node!==root&&node.kind==="comprehension"&&node.collection==="generator")continue;
      for(let index=0;index<node.clauses.length;index++) {
        const clause=node.clauses[index];meter.checkpoint();
        if(clause.async)return true;
        enqueue(clause.target);
        if(index)enqueue(clause.iterable);
        for(const filter of clause.filters)enqueue(filter);
      }
      if(node.kind==="comprehension")enqueue(node.element);
      else {enqueue(node.key);enqueue(node.value);}
      continue;
    }
    meter.checkpoint(0,192);
    for(const child of expressionChildren(node))enqueue(child);
  }
  return false;
}
