import {expect,it} from "vitest";
import {PythonSource} from "./source.js";
import {readEscape} from "./strings.js";
import {lookupUnicodeName} from "./unicode-names.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["n","\n","777","x41","u1234","U0001F600","N{LATIN CAPITAL LETTER A}","q","😀"])("charges escape result storage: %j",text=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0});let active=false;
  const source=new PythonSource(text,"<escapes>",{checkpoint:(steps,bytes)=>{if(active)meter.checkpoint(steps,bytes);}});active=true;
  expect(()=>readEscape(source,false,{offset:0,line:1,column:0},()=>{})).toThrow(ExecutionLimitError);
});
it.each([["q",false],["q",true],["777",false],["777",true]] as const)("preserves warning cancellation for %s (throws=%s)",(text,throws)=>{
  const controller=new AbortController(),source=new PythonSource(text,"<escapes>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal}));
  expect(()=>readEscape(source,false,{offset:0,line:1,column:0},()=>{controller.abort();if(throws)throw new Error("warning failure");})).toThrow(ExecutionLimitError);
});
it.each(["LATIN CAPITAL LETTER A","CJK UNIFIED IDEOGRAPH-4E00","unknown"])("charges Unicode name lookup storage: %s",name=>{
  expect(()=>lookupUnicodeName(name,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});
it("bounds Unicode name scanning",()=>{
  expect(()=>lookupUnicodeName("A".repeat(10000),new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
