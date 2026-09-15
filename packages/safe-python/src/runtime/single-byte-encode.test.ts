import {expect,it,vi} from "vitest";
import {encodeSingleByte} from "./single-byte-encode.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);return {meter,v};}
it.each(["ascii","latin-1"] as const)("encodes native %s code points",encoding=>{
  const {meter,v}=fixture();expect([...encodeSingleByte(v.string(encoding==="ascii"?"abc":"aéÿ").value,encoding,"strict",meter)]).toEqual(encoding==="ascii"?[97,98,99]:[97,233,255]);
});
it.each([["ignore",""],["replace","??"],["backslashreplace","\\xe9\\U0001f40d"],["xmlcharrefreplace","&#233;&#128013;"]] as const)("implements %s replacement",(errors,expected)=>{
  const {meter,v}=fixture();expect([...encodeSingleByte(v.string("é🐍").value,"ascii",errors,meter)]).toEqual([...expected].map(c=>c.charCodeAt(0)));
});
it("groups adjacent unencodable characters into one error span",()=>{
  const {meter,v}=fixture();let error;try{encodeSingleByte(v.string("aéĀz").value,"ascii","strict",meter);}catch(e){error=e;}
  expect(error).toMatchObject({name:"UnicodeEncodeError",encoding:"ascii",start:1,end:3,reason:"ordinal not in range(128)"});
});
it("escapes surrogate bytes and reports the remaining failing span",()=>{
  const {meter,v}=fixture();expect([...encodeSingleByte(v.string("\udc80\udcff").value,"latin-1","surrogateescape",meter)]).toEqual([128,255]);
  let error;try{encodeSingleByte(v.stringPoints(new Uint32Array([0xdc80,0xd800,0xdc81])).value,"latin-1","surrogateescape",meter);}catch(e){error=e;}
  expect(error).toMatchObject({encoding:"latin-1",start:1,end:3});
});
it("uses an explicit canonical Unicode-name capability for name replacement",()=>{
  const {meter,v}=fixture(),name=vi.fn((point:number)=>point===233?"LATIN SMALL LETTER E WITH ACUTE":undefined);
  const result=encodeSingleByte(v.string("é\ud800").value,"ascii","namereplace",meter,name);
  expect(String.fromCharCode(...result)).toBe("\\N{LATIN SMALL LETTER E WITH ACUTE}\\ud800");expect(name.mock.calls).toEqual([[233],[55296]]);
});
it.each([false,true])("preserves cancellation from Unicode-name lookup (throws=%s)",throws=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>encodeSingleByte(v.string("é").value,"ascii","namereplace",meter,()=>{controller.abort();if(throws)throw Error("name failed");return "name";})).toThrow(ExecutionLimitError);
});
