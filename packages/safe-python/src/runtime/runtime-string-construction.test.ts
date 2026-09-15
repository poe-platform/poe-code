import {expect,it,vi} from "vitest";
import {constructRuntimeString} from "./runtime-string-construction.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeComparison} from "./runtime-comparison.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,v,meter).value};
  return {meter,v,keywords:v.dictionary(new OrderedKeyMap(keys,meter))};
}
it("constructs empty strings and preserves exact string identity",()=>{
  const {v,meter,keywords}=fixture(),text=v.string("🐍");
  expect(constructRuntimeString([],keywords,v,meter)).toEqual(v.string(""));
  expect(constructRuntimeString([text],keywords,v,meter)).toBe(text);
  keywords.items.set(v.string("object"),text);
  expect(constructRuntimeString([],keywords,v,meter)).toBe(text);
});
it("uses native representation for non-string values",()=>{
  const {v,meter,keywords}=fixture();
  expect(constructRuntimeString([v.integer(42)],keywords,v,meter)).toEqual(v.string("42"));
  expect(constructRuntimeString([v.none],keywords,v,meter)).toEqual(v.string("None"));
});
it("passes explicit decoding settings and source identity to the codec policy",()=>{
  const {v,meter,keywords}=fixture(),source=v.bytes(new Uint8Array([120])),decode=vi.fn(()=>v.string("decoded"));
  keywords.items.set(v.string("errors"),v.string("replace"));
  expect(constructRuntimeString([source],keywords,v,meter,{decode})).toEqual(v.string("decoded"));
  expect(decode).toHaveBeenCalledWith(source,"utf-8","replace",meter,undefined);
});
it("validates encoding even when the source is omitted, without decoding",()=>{
  const {v,meter,keywords}=fixture(),decode=vi.fn(()=>v.none);
  keywords.items.set(v.string("encoding"),v.string("unknown"));
  expect(constructRuntimeString([],keywords,v,meter,{decode})).toEqual(v.string(""));expect(decode).not.toHaveBeenCalled();
  keywords.items.set(v.string("encoding"),v.none);
  expect(()=>constructRuntimeString([],keywords,v,meter,{decode})).toThrow("str() argument 'encoding' must be str, not None");
});
it("rejects decoding strings before calling the codec policy",()=>{
  const {v,meter,keywords}=fixture(),decode=vi.fn(()=>v.none);
  expect(()=>constructRuntimeString([v.string("x"),v.string("utf-8")],keywords,v,meter,{decode})).toThrow("decoding str is not supported");expect(decode).not.toHaveBeenCalled();
});
it("rejects duplicate and unknown arguments",()=>{
  const {v,meter,keywords}=fixture();keywords.items.set(v.string("object"),v.none);
  expect(()=>constructRuntimeString([v.none],keywords,v,meter)).toThrow("argument for str() given by name ('object') and position (1)");
  keywords.items.clear();keywords.items.set(v.string("unknown"),v.none);
  expect(()=>constructRuntimeString([],keywords,v,meter)).toThrow("str() got an unexpected keyword argument 'unknown'");
});
it("retains the positional-only encoding diagnostic spelling for None",()=>{
  const {v,meter,keywords}=fixture();
  expect(()=>constructRuntimeString([v.none,v.none],keywords,v,meter)).toThrow("str() argument 'encoding' must be str, not NoneType");
});
it.each(["encoding","errors"])("rejects surrogates and NUL in %s before decoding",name=>{
  const {v,meter,keywords}=fixture();keywords.items.set(v.string(name),v.stringPoints(new Uint32Array([0xd800,0xdc00])));
  expect(()=>constructRuntimeString([],keywords,v,meter)).toThrow("surrogates not allowed");
  keywords.items.set(v.string(name),v.string("x\0y"));
  expect(()=>constructRuntimeString([],keywords,v,meter)).toThrow("embedded null character");
});
it.each([false,true])("preserves decoding cancellation (throws=%s)",throws=>{
  const {v,keywords}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>constructRuntimeString([v.bytes(new Uint8Array()),v.string("utf-8")],keywords,v,meter,{decode(){controller.abort();if(throws)throw Error("codec failed");return v.string("x");}})).toThrow(ExecutionLimitError);
});
