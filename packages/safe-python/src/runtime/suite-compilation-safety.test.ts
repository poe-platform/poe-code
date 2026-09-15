import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {compileSuite} from "./suite-compilation.js";
import {cleanDocstring} from "./docstring.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

it.each([false,true])("preserves docstring factory cancellation (throws=%s)",throws=>{
  const controller=new AbortController();
  const constants={string:()=>{controller.abort();if(throws)throw new Error("factory failure");return "doc";}};
  expect(()=>compileSuite(analyzeModule('"doc"').module.body,false,constants,
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
it("charges an empty suite result before allocation",()=>{
  expect(()=>compileSuite([],true,{string:()=>""},new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});
it("charges copied statement slots",()=>{
  const statement=analyzeModule("pass").module.body[0];
  expect(()=>compileSuite(Array.from({length:1000},()=>statement),true,{string:()=>""},
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:1000}))).toThrow(ExecutionLimitError);
});
it.each(["","\t".repeat(100),"😀\n".repeat(100)])("charges docstring temporary storage for %j",text=>{
  const points=Uint32Array.from(text,character=>character.codePointAt(0)!);
  expect(()=>cleanDocstring(points,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:text.length===0?0:100}))).toThrow(ExecutionLimitError);
});
it("keeps stripped docstrings out of the constant factory",()=>{
  const body=analyzeModule('"doc"\npass').module.body;
  const result=compileSuite(body,true,{string:()=>{throw new Error("must not materialize");}},new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:1000}));
  expect(result).toEqual({docstring:undefined,statements:[body[1]]});
  expect(result.statements).not.toBe(body);
});
it("preserves ordinary constant factory failures",()=>{
  const failure=new Error("constant failure");
  expect(()=>compileSuite(analyzeModule('"doc"').module.body,false,{string:()=>{throw failure;}},
    new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000}))).toThrow(failure);
});
