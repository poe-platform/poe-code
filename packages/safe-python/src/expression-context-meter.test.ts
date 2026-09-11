import {expect,it} from "vitest";
import {parseExpression} from "./expression.js";
import {validateExpressionContext,type FunctionNode,type FunctionExecutionKind} from "./expression-context.js";
import type {Expression} from "./ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks context validation %s limits",reason=>{
  const expression=parseExpression("x"),controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>validateExpressionContext(expression,{kind:"module",generator:false},"<string>",undefined,meter)).toThrow(ExecutionLimitError);
});
it("validates 10000 nested expressions without host recursion",()=>{
  const template=parseExpression("not x");if(template.kind!=="unary")throw Error("fixture");
  let expression:Expression=template;for(let i=0;i<10000;i++)expression={...template,operand:expression};
  expect(()=>validateExpressionContext(expression,{kind:"module",generator:false},"<string>",undefined,new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}))).not.toThrow();
});
it("meters lambda parameters without defaults",()=>{
  const expression=parseExpression("lambda x: x");if(expression.kind!=="lambda")throw Error("fixture");
  expect(()=>validateExpressionContext({...expression,parameters:Array(10000).fill(expression.parameters[0])},{kind:"module",generator:false},"<string>",undefined,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("charges syntax diagnostics before constructing them",()=>{
  expect(()=>validateExpressionContext(parseExpression("await x"),{kind:"module",generator:false},"<string>",undefined,{checkpoint(_steps=1,bytes=0){if(bytes>=256)throw new ExecutionLimitError("allocation");}})).toThrow(ExecutionLimitError);
});
it("records nested lambda kinds after their bodies and isolates defaults",()=>{
  const expression=parseExpression("lambda x=(yield 1): (lambda: (yield 2))"),scope={kind:"function" as const,generator:false},kinds=new Map<FunctionNode,FunctionExecutionKind>();
  validateExpressionContext(expression,scope,"<string>",kinds,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}));
  expect(scope.generator).toBe(true);expect([...kinds.values()]).toEqual(["generator","function"]);
});
it("bounds cyclic expression graphs",()=>{
  const expression=parseExpression("not x");if(expression.kind!=="unary")throw Error("fixture");
  const cyclic={...expression};cyclic.operand=cyclic;
  expect(()=>validateExpressionContext(cyclic,{kind:"module",generator:false},"<string>",undefined,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
