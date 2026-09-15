import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { constructRuntimeFloat, type RuntimeFloatConstructionContext } from "./runtime-float-construction.js";

function fixture() {
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  return {v,meter,keywords,call:(args:RuntimeValue[],context?:RuntimeFloatConstructionContext)=>constructRuntimeFloat(args,keywords,v,meter,context)};
}

it.each(["1.25","bad"])("releases float input buffers after parsing %s", text => {
  const {v,call}=fixture(), events:string[]=[];
  const bytes=v.bytes([...text].map(c=>c.charCodeAt(0))).value;
  const context={buffers:{acquireSimple:()=>{events.push("acquire");return {byteLength:bytes.length,copy:()=>{events.push("copy");return bytes;},release:()=>{events.push("release");}};}}};
  if(text==="1.25")expect(call([v.list([])],context)).toEqual(v.float(1.25));
  else expect(()=>call([v.list([])],context)).toThrow("could not convert string to float");
  expect(events).toEqual(["acquire","copy","release"]);
});

it("rewrites guest acquisition failures but retains host errors and fatal limits", () => {
  const {v,call}=fixture(),input=v.list([]);
  expect(()=>call([input],{buffers:{acquireSimple:()=>{throw new PythonRuntimeError("ValueError","export");}}})).toThrow("float() argument must be a string or a real number");
  const host=new Error("host fault"),fatal=new ExecutionLimitError("cancelled");
  expect(()=>call([input],{buffers:{acquireSimple:()=>{throw host;}}})).toThrow(host);
  expect(()=>call([input],{isPythonException:()=>true,buffers:{acquireSimple:()=>{throw fatal;}}})).toThrow(fatal);
});

it("releases acquired float buffers when copying is cancelled", () => {
  const {v,call}=fixture(),fatal=new ExecutionLimitError("cancelled");let releases=0;
  expect(()=>call([v.list([])],{buffers:{acquireSimple:()=>({byteLength:2,copy:()=>{throw fatal;},release:()=>{releases++;}})}})).toThrow(fatal);
  expect(releases).toBe(1);
});

it("normalizes owned float results and warns without invoking their conversions", () => {
  const {v,meter,keywords,call}=fixture();
  const owner=v.type(new RuntimeTypeLayout("FloatChild",[],keywords,meter,{objectLayout:false}),"self");
  const owned=v.instance(owner,undefined,v.float(1.25)),warnings:string[]=[];
  expect(call([owned])).toEqual(v.float(1.25));
  expect(call([v.list([])],{invocation:{lookupSpecial:()=>v.none,call:()=>owned,isStopIteration:()=>false,typeName:value=>value===owned?"FloatChild":"Source",warn:(_category,message)=>warnings.push(message)}})).toEqual(v.float(1.25));
  expect(warnings).toEqual(["Source.__float__ returned non-float (type FloatChild).  The ability to return an instance of a strict subclass of float is deprecated, and may be removed in a future version of Python."]);
});
