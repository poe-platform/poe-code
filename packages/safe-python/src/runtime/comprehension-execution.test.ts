import { expect,it } from "vitest";
import { parseExpression } from "../expression.js";
import { executeComprehensionClauses } from "./comprehension-execution.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";

const node=parseExpression("[x for x in xs if allowed]");
if(node.kind!=="comprehension")throw Error("expected comprehension fixture");
const clause=node.clauses[0];

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
