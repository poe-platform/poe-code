import {expect,it} from "vitest";
import {unicodeCanonicalName} from "./unicode-canonical-name.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each([[0xe9,"LATIN SMALL LETTER E WITH ACUTE"],[0x1f40d,"SNAKE"],[0x1a2,"LATIN CAPITAL LETTER OI"],[0xac00,"HANGUL SYLLABLE GA"],[0x4e00,"CJK UNIFIED IDEOGRAPH-4E00"],[0x18cff,"KHITAN SMALL SCRIPT CHARACTER-18CFF"]] as const)("returns canonical name for U+%s",(point,name)=>{
  expect(unicodeCanonicalName(point)).toBe(name);
});
it.each([0,0x80,0xd800,0x378,0x17000,-1,0x110000,1.5,NaN])("does not invent a name for %s",point=>{
  expect(unicodeCanonicalName(point)).toBeUndefined();
});
it("meters lookup without allocating a runtime reverse-name map",()=>{
  expect(unicodeCanonicalName(0x1f40d,new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:1000}))).toBe("SNAKE");
  const controller=new AbortController();controller.abort();
  expect(()=>unicodeCanonicalName(0x1f40d,new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:1000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
