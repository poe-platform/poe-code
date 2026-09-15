import {expect,it} from "vitest";
import {patternExpressions} from "./pattern-expressions.js";
import {parseExpression} from "./expression.js";
import type {Pattern} from "./pattern-ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

const value=parseExpression("x"),leaf:Pattern={kind:"value",value,start:value.start,end:value.end};
it.each(["steps","allocation","cancelled"] as const)("checks pattern traversal %s limits",reason=>{
  const controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>[...patternExpressions(leaf,meter)]).toThrow(ExecutionLimitError);
});
it("traverses 10000 nested sequences without host recursion",()=>{
  let pattern=leaf;for(let i=0;i<10000;i++)pattern={kind:"sequence",items:[pattern],start:value.start,end:value.end};
  expect([...patternExpressions(pattern,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:10000000}))]).toEqual([value]);
});
it("meters wide patterns containing no value expressions",()=>{
  const pattern:Pattern={kind:"sequence",items:Array(10000).fill({kind:"capture",name:null,start:value.start,end:value.end}),start:value.start,end:value.end};
  expect(()=>[...patternExpressions(pattern,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))]).toThrow(ExecutionLimitError);
});
it("bounds cyclic external patterns",()=>{
  const items:Pattern[]=[],pattern:Pattern={kind:"sequence",items,start:value.start,end:value.end};items.push(pattern);
  expect(()=>[...patternExpressions(pattern,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))]).toThrow(ExecutionLimitError);
});
