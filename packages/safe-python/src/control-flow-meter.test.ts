import {expect,it,vi} from "vitest";
import {parseModule} from "./module.js";
import {analyzeModule} from "./analysis.js";
import {validateControlFlow} from "./control-flow-validation.js";
import * as controlFlow from "./control-flow-validation.js";
import * as expressionContext from "./expression-context.js";
import type {Statement} from "./statement-ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks control flow entry %s limits",reason=>{
  const module=parseModule("pass"),controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>validateControlFlow(module,"<string>",meter)).toThrow(ExecutionLimitError);
});
it("validates 10000 nested statement scopes without host recursion",()=>{
  const module=parseModule("def f():pass"),template=module.body[0];if(template.kind!=="function")throw Error("fixture");
  let statement:Statement=template;for(let i=0;i<10000;i++)statement={...template,body:[statement]};
  expect(validateControlFlow({...module,body:[statement]},"<string>",new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000})).size).toBe(10001);
});
it("bounds a wide expressionless body",()=>{
  const module=parseModule("pass");expect(()=>validateControlFlow({...module,body:Array(10000).fill(module.body[0])},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("charges invalid statement diagnostics before constructing them",()=>{
  expect(()=>validateControlFlow(parseModule("break"),"<string>",{checkpoint(_steps=1,bytes=0){if(bytes>=256)throw new ExecutionLimitError("allocation");}})).toThrow(ExecutionLimitError);
});
it("forwards analysis and control flow meters to expression context validation",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),control=vi.spyOn(controlFlow,"validateControlFlow"),context=vi.spyOn(expressionContext,"validateExpressionContext");
  try{analyzeModule("x",{meter});expect(control.mock.calls[0][2]).toBe(meter);expect(context.mock.calls[0][4]).toBe(meter);}finally{control.mockRestore();context.mockRestore();}
});
it("records function kinds after nested scopes without leaking yields",()=>{
  const module=parseModule("async def outer():\n def inner():\n  yield 1\n await work\ndef gen():\n yield 2");
  expect([...validateControlFlow(module,"<string>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000})).values()]).toEqual(["generator","coroutine","generator"]);
});
it("bounds cyclic statement graphs",()=>{
  const module=parseModule("def f():pass"),template=module.body[0];if(template.kind!=="function")throw Error("fixture");
  const body:Statement[]=[],cyclic={...template,body};body.push(cyclic);
  expect(()=>validateControlFlow({...module,body},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
