import { expect,it } from "vitest";
import { parseExpression } from "../expression.js";
import { ComprehensionCursor,executeComprehensionClauses } from "./comprehension-execution.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";

const node=parseExpression("[x for x in xs if allowed]");
if(node.kind!=="comprehension")throw Error("expected comprehension fixture");
const clause=node.clauses[0];

it("suspends after each element without advancing the next clause or outer iterator",()=>{
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000}),events:string[]=[];
  let bound=0,multiplier=10;
  const outer={next(){events.push("next");return bound<2?{done:false as const,value:bound+1}:{done:true as const,value:undefined};}};
  const cursor=new ComprehensionCursor([clause],outer,{
    evaluate:()=>0,test(){events.push("filter");return true;},iterate:()=>outer,
    assign(_target,value){bound=value;events.push(`assign ${value}`);}
  },()=>{events.push("element");return bound*multiplier;},meter);
  expect(events).toEqual([]);
  expect(cursor.next()).toEqual({done:false,value:10});
  expect(events).toEqual(["next","assign 1","filter","element"]);
  multiplier=100;
  expect(cursor.next()).toEqual({done:false,value:200});
  expect(cursor.next()).toEqual({done:true,value:undefined});
  const finished=[...events];
  expect(cursor.next()).toEqual({done:true,value:undefined});
  expect(events).toEqual(finished);
});

it("retains nested iterator positions and reevaluates inner iterables for each outer item",()=>{
  const parsed=parseExpression("[(x,y) for x in xs for y in ys if allowed]");
  if(parsed.kind!=="comprehension")throw Error("expected comprehension");
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000});
  let x=0,y=0,evaluations=0;
  const cursor=new ComprehensionCursor(parsed.clauses,[1,2][Symbol.iterator](),{
    evaluate(){evaluations++;return x;},test:()=>y%2===0,iterate:value=>[value,value+1][Symbol.iterator](),
    assign(target,value){if(target===parsed.clauses[0].target)x=value;else y=value;}
  },()=>[x,y],meter);
  expect(cursor.next()).toEqual({done:false,value:[1,2]});
  expect(evaluations).toBe(1);
  expect(cursor.next()).toEqual({done:false,value:[2,2]});
  expect(evaluations).toBe(2);
  expect(cursor.next().done).toBe(true);
});

it("terminates after an element failure without closing ordinary clause iterators",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000});
  let pulls=0,closed=false;
  const failure=Error("element failed"),outer={next(){pulls++;return {done:false as const,value:1};},return(){closed=true;return {done:true as const,value:undefined};}};
  const cursor=new ComprehensionCursor([clause],outer,{evaluate:()=>1,test:()=>true,iterate:()=>outer,assign(){}},()=>{throw failure;},meter);
  expect(()=>cursor.next()).toThrow(failure);
  expect(cursor.next()).toEqual({done:true,value:undefined});
  expect(pulls).toBe(1);expect(closed).toBe(false);
});

it.each(["pull","done","assign","filter","evaluate","iterate"])("does not resume clause traversal after %s fails",stage=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000}),failure=Error(stage);
  const events:string[]=[];
  function visit(name:string){events.push(name);if(stage===name)throw failure;}
  const outer={next(){visit("pull");return {get done(){visit("done");return false as const;},value:1};}};
  const cursor=new ComprehensionCursor([clause,clause],outer,{
    evaluate(){visit("evaluate");return 1;},test(){visit("filter");return true;},
    iterate(){visit("iterate");return outer;},assign(){visit("assign");}
  },()=>1,meter);
  expect(()=>cursor.next()).toThrow(failure);
  const failed=[...events];
  expect(cursor.next()).toEqual({done:true,value:undefined});
  expect(events).toEqual(failed);
});

it("checks cancellation before publishing a produced element",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal});
  const cursor=new ComprehensionCursor([clause],[1][Symbol.iterator](),{
    evaluate:()=>1,test:()=>true,iterate:()=>[1][Symbol.iterator](),assign(){}
  },()=>{controller.abort();return 42;},meter);
  expect(()=>cursor.next()).toThrow(ExecutionLimitError);
  expect(()=>cursor.next()).toThrow(ExecutionLimitError);
});

it.each(["assignment","filter"])("does not evaluate an element after cancellation during %s",stage=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal});
  let emitted=false;
  const selected=stage==="assignment"?{...clause,filters:[]}:clause;
  const cursor=new ComprehensionCursor([selected],[1][Symbol.iterator](),{
    evaluate:()=>1,test(){controller.abort();return true;},iterate:()=>[1][Symbol.iterator](),
    assign(){if(stage==="assignment")controller.abort();}
  },()=>{emitted=true;return 42;},meter);
  expect(()=>cursor.next()).toThrow(ExecutionLimitError);
  expect(emitted).toBe(false);
});

it("rejects reentrant traversal before advancing any iterator",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000});
  let pulls=0;
  const outer={next(){pulls++;return {done:false as const,value:1};}};
  const cursor:ComprehensionCursor<number,number>=new ComprehensionCursor([clause],outer,{
    evaluate:()=>1,test:()=>true,iterate:()=>outer,assign(){}
  },()=>{cursor.next();return 1;},meter);
  expect(()=>cursor.next()).toThrow("comprehension cursor is already running");
  expect(pulls).toBe(1);
  expect(cursor.next()).toEqual({done:true,value:undefined});
});

it("validates clauses and reserves cursor storage before consuming the outer iterator",()=>{
  const outer={next(){throw Error("outer iterator must remain untouched");}};
  const context={evaluate:()=>1,test:()=>true,iterate:()=>outer,assign(){}};
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000});
  expect(()=>new ComprehensionCursor([],outer,context,()=>1,meter)).toThrow("requires at least one clause");
  expect(()=>new ComprehensionCursor([clause,{...clause,async:true}],outer,context,()=>1,meter)).toThrow("received an async clause");
  const exhausted=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:0});
  expect(()=>new ComprehensionCursor([clause],outer,context,()=>1,exhausted)).toThrow(ExecutionLimitError);
});

it("walks deeply nested comprehension clauses without recursive host calls",()=>{
  const clauses=Array.from({length:5000},()=>clause),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000});
  let emits=0,assignments=0;
  executeComprehensionClauses(clauses,[1][Symbol.iterator](),{
    evaluate:()=>1,test:()=>true,iterate:()=>[1][Symbol.iterator](),assign:()=>{assignments++;}
  },()=>{emits++;},meter);
  expect(emits).toBe(1);expect(assignments).toBe(5000);
});

it("bounds infinite comprehension iterators and does not close them",()=>{
  const meter=new ExecutionBudget({maxSteps:30,maxAllocatedBytes:1000});
  let closed=false;
  const iterator={next:()=>({done:false as const,value:1}),return(){closed=true;return {done:true as const,value:undefined};}};
  expect(()=>executeComprehensionClauses([clause],iterator,{evaluate:()=>1,test:()=>true,iterate:()=>iterator,assign(){}},()=>{},meter)).toThrow(ExecutionLimitError);
  expect(closed).toBe(false);
});

it("short-circuits filters before later iterable evaluation",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000});
  const events:string[]=[];
  executeComprehensionClauses([clause,clause],[1][Symbol.iterator](),{
    evaluate(){throw Error("later iterable should not execute");},iterate(){throw Error("later iterator should not be acquired");},
    assign(){events.push("assign");},test(){events.push("test");return false;}
  },()=>{throw Error("body should not execute");},meter);
  expect(events).toEqual(["assign","test"]);
});
