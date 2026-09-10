import type { ComprehensionClause, Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { StatementContext,ResumableStatementContext } from "./statement-execution.js";

export type ComprehensionNode = Extract<Expression,{kind:"comprehension"|"dictionary-comprehension"}>;

type ComprehensionContext<Value> = Pick<StatementContext<Value>,"evaluate"|"test"|"iterate"|"assign">;
type ResumableContext<Value> = Pick<ResumableStatementContext<Value>,"evaluate"|"test"|"iterate"|"assign"|"asyncIterate">;
type AsyncClauseIterator<Value>=ReturnType<NonNullable<ResumableContext<Value>["asyncIterate"]>>;
export type ComprehensionIterator<Value> = {kind:"sync";value:Iterator<Value>}|{kind:"async";value:AsyncClauseIterator<Value>};
type State<Value,Result>={clauses:readonly ComprehensionClause[];iterators:Array<Iterator<Value>|AsyncClauseIterator<Value>>} & (
  {kind:"sync";context:ComprehensionContext<Value>;emit:()=>Result}|
  {kind:"resumable";context:ResumableContext<Value>;emit:()=>Generator<Value,Result,Value>});

/** Shared iterative clause traversal. A step stops immediately after emission;
 * suspension only comes from the resumable context's guest operations. */
function* advanceComprehension<Value,Result>(state:State<Value,Result>,meter:ExecutionMeter):Generator<Value,IteratorResult<Result,undefined>,Value> {
  const {clauses,iterators}=state;
  while(iterators.length) {
    meter.checkpoint();
    const index=iterators.length-1,clause=clauses[index],iterator=iterators[index];
    const step=clause.async?yield* (iterator as AsyncClauseIterator<Value>).next():(iterator as Iterator<Value>).next();
    meter.checkpoint();
    if(step.done){iterators.pop();continue;}
    if(state.kind==="sync")state.context.assign(clause.target,step.value);
    else yield* state.context.assign(clause.target,step.value);
    let accepted=true;
    for(const filter of clause.filters) {
      meter.checkpoint();
      const result=state.kind==="sync"?state.context.test(filter):yield* state.context.test(filter);
      if(!result){accepted=false;break;}
    }
    if(!accepted)continue;
    meter.checkpoint();
    if(index+1===clauses.length) {
      const value=state.kind==="sync"?state.emit():yield* state.emit();
      meter.checkpoint();return {done:false,value};
    }
    const next=clauses[index+1];
    const source=state.kind==="sync"?state.context.evaluate(next.iterable):yield* state.context.evaluate(next.iterable);
    meter.checkpoint();
    if(next.async) {
      if(state.kind!=="resumable"||state.context.asyncIterate===undefined)throw Error("async comprehension iteration unavailable");
      iterators.push(state.context.asyncIterate(source));
    } else iterators.push(state.context.iterate(source));
  }
  return {done:true,value:undefined};
}

/** A pull resumes at the next candidate, never prefetching across an element.
 * State is released on exhaustion or failure; ordinary iterators are not closed.
 * Generator send/throw/close and exception conversion belong to the surrounding
 * generator lifecycle, not this synchronous clause traversal. */
export class ComprehensionCursor<Value,Result> implements Iterator<Result,undefined> {
  #state:State<Value,Result>|undefined;
  #running=false;
  constructor(clauses:readonly ComprehensionClause[],outer:Iterator<Value>,context:ComprehensionContext<Value>,emit:()=>Result,private readonly meter:ExecutionMeter) {
    meter.checkpoint(1,160+clauses.length*8);
    if(clauses.length===0)throw Error("comprehension requires at least one clause");
    for(const clause of clauses){meter.checkpoint();if(clause.async)throw Error("synchronous comprehension received an async clause");}
    this.#state={kind:"sync",clauses,context,emit,iterators:[outer]};
    Object.freeze(this);
  }
  next():IteratorResult<Result,undefined> {
    this.meter.checkpoint(1,32);
    if(this.#running)throw Error("comprehension cursor is already running");
    const state=this.#state;
    if(state===undefined)return {done:true,value:undefined};
    this.#running=true;
    try {
      this.meter.checkpoint(0,192);
      const step=advanceComprehension(state,this.meter).next();
      if(!step.done)throw Error("synchronous comprehension unexpectedly suspended");
      if(step.value.done)this.#state=undefined;
      return step.value;
    } catch(error) {
      this.#state=undefined;
      throw error;
    } finally {this.#running=false;}
  }
}

/** Materialize suspended comprehensions without recursive clause nesting. The
 * outer iterator has already been acquired in the enclosing scope. */
export function* createComprehensionContinuation<Value>(clauses:readonly ComprehensionClause[],outer:ComprehensionIterator<Value>,context:ResumableContext<Value>,emit:()=>Generator<Value,void,Value>,meter:ExecutionMeter):Generator<Value,void,Value> {
  meter.checkpoint(1,192+clauses.length*8);
  if(clauses.length===0)throw Error("comprehension requires at least one clause");
  const state:State<Value,void>={kind:"resumable",clauses,context,emit,iterators:[outer.value]};
  try {
    while(true) {
      meter.checkpoint(0,192);
      if((yield* advanceComprehension(state,meter)).done)return;
    }
  } finally {state.iterators.length=0;}
}

/** Walk synchronous clauses without recursive nesting or iterator hints.
 * The caller acquires the outer iterator in the enclosing scope; all remaining
 * evaluation, target binding and emission use the comprehension's scope.
 * Abrupt completion does not close ordinary iterators or undo guest effects. */
export function executeComprehensionClauses<Value>(clauses:readonly ComprehensionClause[],outer:Iterator<Value>,context:ComprehensionContext<Value>,emit:()=>void,meter:ExecutionMeter):void {
  const cursor=new ComprehensionCursor(clauses,outer,context,emit,meter);
  while(!cursor.next().done)meter.checkpoint();
}
