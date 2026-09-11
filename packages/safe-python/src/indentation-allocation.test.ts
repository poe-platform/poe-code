import {expect,it} from "vitest";
import {Indentation} from "./indentation.js";
import {PythonSource} from "./source.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each([""," ","\t","\f"," \f  "])("charges indentation output and level storage: %j",whitespace=>{
  const indentation=new Indentation(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});let active=false;
  const source=new PythonSource("","<indentation>",{checkpoint:(steps,bytes)=>{if(active)meter.checkpoint(steps,bytes);}});active=true;
  expect(()=>indentation.accept(whitespace,source)).toThrow(ExecutionLimitError);
});
it("bounds standalone indentation scanning",()=>{
  const indentation=new Indentation(),source=new PythonSource("","<indentation>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}));
  expect(()=>indentation.accept(" ".repeat(10000),source)).toThrow(ExecutionLimitError);
});
it.each([0,3])("charges final dedent storage with %i levels",levels=>{
  const indentation=new Indentation(),source=new PythonSource("");for(let level=1;level<=levels;level++)indentation.accept(" ".repeat(level),source);
  expect(()=>indentation.finish(new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});
it("charges initial indentation storage",()=>{
  expect(()=>new Indentation(new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a throwing diagnostic filename accessor",()=>{
  const indentation=new Indentation(),controller=new AbortController(),source=new PythonSource("","<indentation>",new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  indentation.accept("  ",source);
  Object.defineProperty(source,"filename",{get:()=>{controller.abort();throw new Error("filename failure");}});
  expect(()=>indentation.accept(" ",source)).toThrow(ExecutionLimitError);
});
