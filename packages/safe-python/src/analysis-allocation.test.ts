import {expect,it,vi} from "vitest";
import {analyzeModule} from "./analysis.js";
import * as attributes from "./static-attributes.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["", "def f(x): return x", "class C:\n def f(self): self.x=1"])("reserves the completed analysis record: %s",source=>{
  let completed=false;
  const collect=attributes.collectStaticAttributes;
  const spy=vi.spyOn(attributes,"collectStaticAttributes").mockImplementation((...args)=>{
    const result=collect(...args);completed=true;return result;
  });
  const budget=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0});
  try {
    expect(()=>analyzeModule(source,{meter:{checkpoint:(steps,bytes)=>{if(completed)budget.checkpoint(steps,bytes);}}})).toThrow(ExecutionLimitError);
    expect(completed).toBe(true);
  } finally {spy.mockRestore();}
});
