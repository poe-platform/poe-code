import {expect,it} from "vitest";
import type {Expression} from "./ast.js";
import {parseExpression} from "./expression.js";
import {patternLiteralKey} from "./pattern-literal-keys.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(['"value"','b"value"','1','1.5','-1','1+2j'])("charges literal equality key allocation: %s",source=>{
  const expression=parseExpression(source),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});
  expect(()=>patternLiteralKey(expression,meter)).toThrow(ExecutionLimitError);
});
it.each(['"'+"a".repeat(10000)+'"','b"'+"a".repeat(10000)+'"'])("charges typed-buffer key work",source=>{
  const expression=parseExpression(source),meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000000});
  expect(()=>patternLiteralKey(expression,meter)).toThrow(ExecutionLimitError);
});
it("validates deeply nested numeric ASTs without the host call stack",()=>{
  let expression=parseExpression("1");for(let index=0;index<50000;index++)expression={kind:"unary",operator:"-",operand:expression,start:expression.start,end:expression.end};
  expect(patternLiteralKey(expression,new ExecutionBudget({maxSteps:10000000,maxAllocatedBytes:100000000}))).toBe("number:1");
});
it("bounds cyclic external numeric AST traversal",()=>{
  const expression=parseExpression("-1");if(expression.kind!=="unary")throw new Error("expected unary");
  Object.assign(expression,{operand:expression});
  expect(()=>patternLiteralKey(expression,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
});
it.each([false,true])("preserves cancellation from expression accessors (throws=%s)",throws=>{
  const controller=new AbortController(),expression=parseExpression("1");
  Object.defineProperty(expression,"kind",{get:()=>{controller.abort();if(throws)throw new Error("accessor failure");return "literal";}});
  expect(()=>patternLiteralKey(expression as Expression,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
