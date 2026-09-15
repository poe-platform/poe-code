import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {compileLiteralPool} from "./literal-pool.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

it.each(["literal","tuple"] as const)("preserves cancellation when the %s factory throws",kind=>{
  const body=analyzeModule("a=(1,)").module.body,controller=new AbortController();
  const fail=()=>{controller.abort();throw new Error("factory failure");};
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>compileLiteralPool(body,kind==="literal"?fail:()=>1,meter,kind==="tuple"?fail:()=>1)).toThrow(ExecutionLimitError);
});
it.each(["literal","tuple"] as const)("retains ordinary %s factory errors without cancellation",kind=>{
  const failure=new Error("factory failure"),fail=()=>{throw failure;};
  expect(()=>compileLiteralPool(analyzeModule("a=(1,)").module.body,kind==="literal"?fail:()=>1,
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),kind==="tuple"?fail:()=>1)).toThrow(failure);
});
it("meters scans of parameters without defaults",()=>{
  const fn=analyzeModule("def f(x):pass").module.body[0];
  if(fn.kind!=="function")throw new Error("expected function");
  const body=[{...fn,parameters:Array.from({length:10000},()=>fn.parameters[0])}];
  expect(()=>compileLiteralPool(body,()=>1,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
