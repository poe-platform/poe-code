import {expect,it,vi} from "vitest";
import {PythonSource} from "./source.js";
import {readString,escapeWarning} from "./strings.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(['""','b""','"abc"','b"abc"','r"abc"','br"abc"','"\\n"','"\\u1234"','"\\N{LATIN CAPITAL LETTER A}"','"""a\nb"""'])("charges string token storage independently of positions: %s",text=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0});let active=false;
  const source=new PythonSource(text,"<strings>",{checkpoint:(steps,bytes)=>{if(active)meter.checkpoint(steps,bytes);}});
  const spy=vi.spyOn(PythonSource.prototype,"position","get").mockReturnValue({offset:0,line:1,column:0});active=true;
  try{expect(()=>readString(source)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it.each(['"\\q"','b"\\q"'])("reserves final decoded buffer after warning callbacks: %s",text=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0});let active=false;
  const source=new PythonSource(text,"<strings>",{checkpoint:(steps,bytes)=>{if(active)meter.checkpoint(steps,bytes);}});
  expect(()=>readString(source,()=>{active=true;})).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a throwing string warning callback",()=>{
  const controller=new AbortController(),source=new PythonSource('"\\q"',"<strings>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal}));
  expect(()=>readString(source,()=>{controller.abort();throw new Error("warning failure");})).toThrow(ExecutionLimitError);
});
it("reserves dynamic escape-warning storage",()=>{
  expect(()=>escapeWarning("q".repeat(10000),false,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100}))).toThrow(ExecutionLimitError);
});
