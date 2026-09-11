import {expect,it,vi} from "vitest";
import {normalizeNfkc} from "./normalization.js";
import * as normalization from "./normalization.js";
import {parseModule} from "./module.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks normalization entry %s limits",reason=>{
  const controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>normalizeNfkc("Ａ",meter)).toThrow(ExecutionLimitError);
});
it("bounds compatibility expansion before constructing the complete output",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000});
  expect(()=>normalizeNfkc("\ufdfa".repeat(10000),meter)).toThrow(ExecutionLimitError);
});
it("checks the meter inside combining-class sort comparisons",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const original=Array.prototype.sort;let comparisons=0;
  const spy=vi.spyOn(Array.prototype,"sort").mockImplementation(function(this:unknown[],compare){controller.abort();return original.call(this,(a,b)=>{comparisons++;return compare!(a,b);});});
  try{expect(()=>normalizeNfkc("x"+"\u0315\u0300".repeat(1000),meter)).toThrow(ExecutionLimitError);expect(comparisons).toBe(1);}
  finally{spy.mockRestore();}
});
it.each(["ascii_123","ﬃ","\ufdfa","a\u0315\u0300","\u1100\u1161\u11a8","\u{1ccd6}","\ud800",""])("retains Unicode normalization of %j with accounting enabled",source=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  expect(normalizeNfkc(source,meter)).toBe(normalizeNfkc(source));
  expect(meter.usage.steps).toBeGreaterThan(0);expect(meter.usage.allocatedBytes).toBeGreaterThan(0);
});
it.each([
  "Ａ", "obj.Ａ", "def Ａ(Ｂ):pass", "class Ａ:pass", "global Ａ", "nonlocal Ａ",
  "import Ａ as Ｂ", "from Ａ import Ｂ", "try:\n pass\nexcept Exception as Ａ:\n pass",
  "match x:\n case Ａ:pass", "type Ａ[Ｂ] = Ｂ", "def f(Ａ):pass"
])("forwards the parser meter while normalizing %s",source=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),spy=vi.spyOn(normalization,"normalizeNfkc");
  try{parseModule(source,{meter});expect(spy).toHaveBeenCalled();for(const call of spy.mock.calls)expect(call[1]).toBe(meter);}
  finally{spy.mockRestore();}
});
