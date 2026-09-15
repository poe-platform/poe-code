import {expect,it,vi} from "vitest";
import {analyzeModule} from "../analysis.js";
import {compileProgram} from "./program-compilation.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

it.each([false,true])("preserves cancellation from the final class-name factory (throws=%s)",throws=>{
  const analysis=analyzeModule("class C:pass"),controller=new AbortController();let names=0;
  const constants={string:(name:string)=>{if(name==="C"&&++names===2){controller.abort();if(throws)throw new Error("factory failure");}return name;},integer:()=>"",tuple:()=>""};
  expect(()=>compileProgram(analysis,{stripDocstring:true},constants,
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
it("reserves program metadata before invoking constant factories",()=>{
  const analysis=analyzeModule(""),factory=vi.fn(()=>"");
  expect(()=>compileProgram(analysis,{stripDocstring:true},{string:factory,integer:factory,tuple:factory},
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:32}))).toThrow(ExecutionLimitError);
  expect(factory).not.toHaveBeenCalled();
});
it("charges all empty-program registry storage",()=>{
  expect(()=>compileProgram(analyzeModule(""),{stripDocstring:true},{string:()=>"",integer:()=>"",tuple:()=>""},
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:500}))).toThrow(ExecutionLimitError);
});
