import type { ComprehensionClause, Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { StatementContext } from "./statement-execution.js";

export type ComprehensionNode = Extract<Expression,{kind:"comprehension"|"dictionary-comprehension"}>;

/** Walk synchronous clauses without recursive nesting or iterator hints.
 * The caller acquires the outer iterator in the enclosing scope; all remaining
 * evaluation, target binding and emission use the comprehension's scope.
 * Abrupt completion does not close ordinary iterators or undo guest effects. */
export function executeComprehensionClauses<Value>(clauses:readonly ComprehensionClause[],outer:Iterator<Value>,context:Pick<StatementContext<Value>,"evaluate"|"test"|"iterate"|"assign">,emit:()=>void,meter:ExecutionMeter):void {
  meter.checkpoint(1,32+clauses.length*8);
  if(clauses.length===0)throw Error("comprehension requires at least one clause");
  for(const clause of clauses){meter.checkpoint();if(clause.async)throw Error("synchronous comprehension received an async clause");}
  const iterators:Iterator<Value>[]=[outer];
  while(iterators.length) {
    meter.checkpoint();
    const index=iterators.length-1,clause=clauses[index],step=iterators[index].next();
    meter.checkpoint();
    if(step.done){iterators.pop();continue;}
    context.assign(clause.target,step.value);
    let accepted=true;
    for(const filter of clause.filters){meter.checkpoint();if(!context.test(filter)){accepted=false;break;}}
    if(!accepted)continue;
    if(index+1===clauses.length){emit();continue;}
    const iterable=context.evaluate(clauses[index+1].iterable);
    meter.checkpoint();iterators.push(context.iterate(iterable));
  }
}
