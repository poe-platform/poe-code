import {expect,it} from "vitest";
import {PythonSource} from "./source.js";
import {readNumber} from "./numbers.js";
import {readIdentifier} from "./identifiers.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["0","123","0xff","0b101","0o777","1_234","1.25","1e30","2j","1_2.3_4j"])("charges numeric token storage independently of source positions: %s",text=>{
  const budget=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:64});let active=false;
  const source=new PythonSource(text,"<tokens>",{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});active=true;
  expect(()=>readNumber(source)).toThrow(ExecutionLimitError);
});
it.each(["name","Kelvin","𐐀name"])("charges identifier token storage independently of source positions: %s",text=>{
  const budget=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:64});let active=false;
  const source=new PythonSource(text,"<tokens>",{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});active=true;
  expect(()=>readIdentifier(source)).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a throwing numeric warning callback",()=>{
  const controller=new AbortController(),source=new PythonSource("1and","<tokens>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal}));
  expect(()=>readNumber(source,()=>{controller.abort();throw new Error("warning failure");})).toThrow(ExecutionLimitError);
});
