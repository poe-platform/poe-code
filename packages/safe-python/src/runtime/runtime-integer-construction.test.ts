import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { constructRuntimeInteger, type RuntimeIntegerConstructionContext } from "./runtime-integer-construction.js";

function fixture() {
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}), v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  return {v,meter,keywords,call:(args:RuntimeValue[],context?:RuntimeIntegerConstructionContext)=>constructRuntimeInteger(args,keywords,v,meter,context)};
}

it.each(["12","bad"])("releases acquired buffers after parsing %s", text => {
  const {v,call}=fixture(), events:string[]=[];
  const input=v.list([]), bytes=v.bytes(new Uint8Array([...text].map(c=>c.charCodeAt(0)))).value;
  const context={buffers:{acquireSimple:()=>{events.push("acquire");return {byteLength:bytes.length,copy:()=>{events.push("copy");return bytes;},release:()=>{events.push("release");}};}}};
  if(text==="12")expect(call([input],context)).toEqual(v.integer(12));
  else expect(()=>call([input],context)).toThrow("invalid literal for int() with base 10");
  expect(events).toEqual(["acquire","copy","release"]);
});

it("allows bytearray with explicit base but does not acquire general buffers", () => {
  const {v,call}=fixture(), input=v.list([]), bytes=v.bytes(new Uint8Array([49,48])).value;
  expect(call([input,v.integer(2)],{byteArray:()=>bytes})).toEqual(v.integer(2));
  expect(()=>call([input,v.integer(2)],{buffers:{acquireSimple:()=>{throw Error("must not acquire");}}})).toThrow("int() can't convert non-string with explicit base");
});

it("rewrites guest buffer acquisition errors but preserves fatal limits", () => {
  const {v,call}=fixture(), input=v.list([]);
  expect(()=>call([input],{buffers:{acquireSimple:()=>{throw new PythonRuntimeError("ValueError","export failed");}}})).toThrow("int() argument must be a string, a bytes-like object or a real number");
  const fatal=new ExecutionLimitError("cancelled");
  expect(()=>call([input],{buffers:{acquireSimple:()=>{throw fatal;}}})).toThrow(fatal);
});

it("releases acquired buffers when copying is cancelled", () => {
  const {v,call}=fixture(), fatal=new ExecutionLimitError("cancelled");let releases=0;
  expect(()=>call([v.list([])],{buffers:{acquireSimple:()=>({byteLength:2,copy:()=>{throw fatal;},release:()=>{releases++;}})}})).toThrow(fatal);
  expect(releases).toBe(1);
});

it("does not rewrite host buffer acquisition faults as guest type errors", () => {
  const {v,call}=fixture(),fault=Error("host failure");
  try{call([v.list([])],{buffers:{acquireSimple(){throw fault;}}});expect.unreachable();}catch(error){expect(error).toBe(fault);}
});
