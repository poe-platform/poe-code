import type { ComprehensionClause, Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { StatementContext } from "./statement-execution.js";

export type ComprehensionNode = Extract<Expression,{kind:"comprehension"|"dictionary-comprehension"}>;

type ComprehensionContext<Value> = Pick<StatementContext<Value>,"evaluate"|"test"|"iterate"|"assign">;

/** A pull resumes at the next candidate, never prefetching across an element.
 * State is released on exhaustion or failure; ordinary iterators are not closed.
 * Generator send/throw/close and exception conversion belong to the surrounding
 * generator lifecycle, not this synchronous clause traversal. */
export class ComprehensionCursor<Value,Result> implements Iterator<Result,undefined> {
  #state:{clauses:readonly ComprehensionClause[];context:ComprehensionContext<Value>;emit:()=>Result;iterators:Iterator<Value>[]}|undefined;
  #running=false;
  constructor(clauses:readonly ComprehensionClause[],outer:Iterator<Value>,context:ComprehensionContext<Value>,emit:()=>Result,private readonly meter:ExecutionMeter) {
    meter.checkpoint(1,128+clauses.length*8);
    if(clauses.length===0)throw Error("comprehension requires at least one clause");
    for(const clause of clauses){meter.checkpoint();if(clause.async)throw Error("synchronous comprehension received an async clause");}
    this.#state={clauses,context,emit,iterators:[outer]};
    Object.freeze(this);
  }
  next():IteratorResult<Result,undefined> {
    this.meter.checkpoint(1,32);
    if(this.#running)throw Error("comprehension cursor is already running");
    const state=this.#state;
    if(state===undefined)return {done:true,value:undefined};
    this.#running=true;
    try {
      const {clauses,context,iterators}=state;
      while(iterators.length) {
        this.meter.checkpoint();
        const index=iterators.length-1,clause=clauses[index],step=iterators[index].next();
        this.meter.checkpoint();
        if(step.done){iterators.pop();continue;}
        context.assign(clause.target,step.value);
        let accepted=true;
        for(const filter of clause.filters){this.meter.checkpoint();if(!context.test(filter)){accepted=false;break;}}
        if(!accepted)continue;
        this.meter.checkpoint();
        if(index+1===clauses.length){
          const value=state.emit();
          this.meter.checkpoint();
          return {done:false,value};
        }
        const iterable=context.evaluate(clauses[index+1].iterable);
        this.meter.checkpoint();iterators.push(context.iterate(iterable));
      }
      this.#state=undefined;
      return {done:true,value:undefined};
    } catch(error) {
      this.#state=undefined;
      throw error;
    } finally {this.#running=false;}
  }
}

/** Walk synchronous clauses without recursive nesting or iterator hints.
 * The caller acquires the outer iterator in the enclosing scope; all remaining
 * evaluation, target binding and emission use the comprehension's scope.
 * Abrupt completion does not close ordinary iterators or undo guest effects. */
export function executeComprehensionClauses<Value>(clauses:readonly ComprehensionClause[],outer:Iterator<Value>,context:ComprehensionContext<Value>,emit:()=>void,meter:ExecutionMeter):void {
  const cursor=new ComprehensionCursor(clauses,outer,context,emit,meter);
  while(!cursor.next().done)meter.checkpoint();
}
