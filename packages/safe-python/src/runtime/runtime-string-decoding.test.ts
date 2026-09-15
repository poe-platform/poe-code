import {expect,it,vi} from "vitest";
import {createRuntimeStringDecoder} from "./runtime-string-decoding.js";
import {constructRuntimeString} from "./runtime-string-construction.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);return {meter,v};}
it("does not call custom codecs or copy empty buffers",()=>{
  const {v,meter}=fixture(),codec=vi.fn(()=>v.string("wrong")),decode=createRuntimeStringDecoder(codec,v),copy=vi.fn(),release=vi.fn();
  expect(decode(v.bytes(new Uint8Array()),"custom","strict",meter,undefined)).toEqual(v.string(""));
  expect(decode(v.cell({}),"custom","strict",meter,{call:vi.fn(),buffers:{acquireSimple:()=>({byteLength:0,copy,release})}})).toEqual(v.string(""));
  expect(codec).not.toHaveBeenCalled();expect(copy).not.toHaveBeenCalled();expect(release).toHaveBeenCalledTimes(1);
});
it("passes exact immutable bytes directly to the codec without acquiring a buffer",()=>{
  const {v,meter}=fixture(),source=v.bytes(new Uint8Array([120])),result=v.string("x"),codec=vi.fn(()=>result),acquireSimple=vi.fn();
  const decode=createRuntimeStringDecoder(codec,v);
  expect(decode(source,"utf-8","strict",meter,{call:vi.fn(),buffers:{acquireSimple}})).toBe(result);
  expect(codec).toHaveBeenCalledWith(source.value,"utf-8","strict",meter,expect.anything());expect(acquireSimple).not.toHaveBeenCalled();
});
it("holds a copied buffer through decoding and releases it exactly once",()=>{
  const {v,meter}=fixture(),source=v.cell({}),bytes=v.bytes(new Uint8Array([120])).value,release=vi.fn(),copy=vi.fn(()=>bytes),codec=vi.fn(()=>{expect(release).not.toHaveBeenCalled();return v.string("x");});
  const invocation:BuiltinInvocationContext={call:vi.fn(),buffers:{acquireSimple:()=>({byteLength:1,copy,release})}};
  expect(createRuntimeStringDecoder(codec,v)(source,"utf-8","replace",meter,invocation)).toEqual(v.string("x"));
  expect(copy).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);expect(codec).toHaveBeenCalledWith(bytes,"utf-8","replace",meter,invocation);
});
it("rejects text and missing buffer protocols before codec lookup",()=>{
  const {v,meter}=fixture(),codec=vi.fn(),decode=createRuntimeStringDecoder(codec,v);
  expect(()=>decode(v.string("x"),"unknown","strict",meter,undefined)).toThrow("decoding str is not supported");
  expect(()=>decode(v.none,"unknown","strict",meter,undefined)).toThrow("decoding to str: need a bytes-like object, NoneType found");expect(codec).not.toHaveBeenCalled();
});
it("releases a buffer when the codec fails",()=>{
  const {v,meter}=fixture(),failure=Error("codec failed"),release=vi.fn(),bytes=v.bytes(new Uint8Array([120])).value;
  expect(()=>createRuntimeStringDecoder(()=>{throw failure;},v)(v.cell({}),"unknown","strict",meter,{call:vi.fn(),buffers:{acquireSimple:()=>({byteLength:1,copy:()=>bytes,release})}})).toThrow(failure);
  expect(release).toHaveBeenCalledTimes(1);
});
it.each(["acquire","copy","codec"] as const)("releases buffers and preserves cancellation from %s",phase=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal}),release=vi.fn(),bytes=v.bytes(new Uint8Array([120])).value;
  const failure=()=>{controller.abort();throw Error("callback failed");};
  const codec=phase==="codec"?failure:vi.fn(()=>v.string("x")),copy=phase==="copy"?failure:()=>bytes;
  expect(()=>createRuntimeStringDecoder(codec,v)(v.cell({}),"utf-8","strict",meter,{call:vi.fn(),buffers:{acquireSimple(){if(phase==="acquire")controller.abort();return {byteLength:1,copy,release};}}})).toThrow(ExecutionLimitError);
  expect(release).toHaveBeenCalledTimes(1);
});
it("composes with string construction after name validation and before codec lookup",()=>{
  const {v,meter}=fixture(),source=v.cell({}),bytes=v.bytes(new Uint8Array([120])).value,release=vi.fn(),acquireSimple=vi.fn(()=>({byteLength:1,copy:()=>bytes,release})),codec=vi.fn(()=>v.string("x"));
  const keywords=v.dictionary(new OrderedKeyMap({hash:()=>1n,equal:(a,b)=>a===b},meter)),context={decode:createRuntimeStringDecoder(codec,v),invocation:{call:vi.fn(),buffers:{acquireSimple}}};
  expect(()=>constructRuntimeString([source,v.none],keywords,v,meter,context)).toThrow("encoding");expect(acquireSimple).not.toHaveBeenCalled();
  expect(constructRuntimeString([source,v.string("custom")],keywords,v,meter,context)).toEqual(v.string("x"));
  expect(acquireSimple).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);expect(codec).toHaveBeenCalledTimes(1);
});
it("propagates buffer acquisition failures without consulting a codec",()=>{
  const {v,meter}=fixture(),failure=Error("export failed"),codec=vi.fn();
  expect(()=>createRuntimeStringDecoder(codec,v)(v.cell({}),"unknown","strict",meter,{call:vi.fn(),buffers:{acquireSimple(){throw failure;}}})).toThrow(failure);expect(codec).not.toHaveBeenCalled();
});
