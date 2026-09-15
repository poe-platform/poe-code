import {expect,it,vi} from "vitest";
import {createRuntimeUtf8Encoder} from "./runtime-utf8-encoding.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);return {meter,v,encode:createRuntimeUtf8Encoder(v)};}
it.each(["utf-8","UTF8"," utf---8 ","u8","utf8_ucs2","utf8_ucs4","cp65001"])("encodes UTF-8 alias %s",encoding=>{
  const {meter,v,encode}=fixture();expect(encode(v.string("🐍"),encoding,"strict",meter,undefined)).toEqual(v.bytes(new Uint8Array([240,159,144,141])));
});
it.each([["ignore",[]],["replace",[63]],["surrogateescape",[128]],["surrogatepass",[237,178,128]],["backslashreplace",[92,117,100,99,56,48]],["namereplace",[92,117,100,99,56,48]],["xmlcharrefreplace",[38,35,53,54,52,52,56,59]]] as const)("uses encoding error handler %s",(errors,bytes)=>{
  const {meter,v,encode}=fixture();expect(encode(v.string("\udc80"),"utf-8",errors,meter,undefined)).toEqual(v.bytes(new Uint8Array(bytes)));
});
it("resolves codec names even for empty input but looks up error handlers lazily",()=>{
  const {meter,v,encode}=fixture();
  expect(()=>encode(v.string(""),"unknown","strict",meter,undefined)).toThrow("unknown encoding: unknown");
  expect(encode(v.string("valid"),"utf-8","unknown",meter,undefined)).toEqual(v.bytes(new Uint8Array([118,97,108,105,100])));
  expect(()=>encode(v.string("\ud800"),"utf-8","unknown",meter,undefined)).toThrow("unknown error handler name 'unknown'");
});
it("delegates unsupported codecs and custom error handling with original inputs",()=>{
  const {meter,v}=fixture(),fallback=vi.fn(()=>v.bytes(new Uint8Array([7]))),encode=createRuntimeUtf8Encoder(v,fallback),text=v.string("\ud800");
  encode(text,"Custom Codec","custom",meter,undefined);expect(fallback).toHaveBeenLastCalledWith(text,"Custom Codec","custom",meter,undefined);
  encode(text,"UTF-8","custom",meter,undefined);expect(fallback).toHaveBeenLastCalledWith(text,"UTF-8","custom",meter,undefined);
});
it.each([false,true])("preserves cancellation from encoding extensions (throws=%s)",throws=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>createRuntimeUtf8Encoder(v,()=>{controller.abort();if(throws)throw Error("extension failed");return v.none;})(v.string("x"),"custom","strict",meter,undefined)).toThrow(ExecutionLimitError);
});
it.each(["ascii","latin-1"])("calls custom handler fallback only after an encoding failure for %s",encoding=>{
  const {meter,v}=fixture(),events:string[]=[],text=v.string("Ā");
  const fallback=vi.fn((input,original,errors)=>{events.push("fallback");expect(input).toBe(text);expect(original).toBe(encoding);expect(errors).toBe("custom");return v.bytes(new Uint8Array([7]));});
  const encode=createRuntimeUtf8Encoder(v,fallback);
  encode(v.string(""),encoding,"custom",meter,undefined);
  encode(v.string("abc"),encoding,"custom",meter,undefined);
  expect(events).toEqual([]);
  expect(encode(text,encoding,"custom",meter,undefined)).toEqual(v.bytes(new Uint8Array([7])));
  expect(events).toEqual(["fallback"]);
  expect(()=>encode(text,encoding,"strict",meter,undefined)).toThrow("ordinal not in range");
  expect(fallback).toHaveBeenCalledTimes(1);
});
it.each([false,true])("preserves cancellation during single-byte custom error handling (throws=%s)",throws=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>createRuntimeUtf8Encoder(v,()=>{controller.abort();if(throws)throw Error("handler failed");return v.none;})(v.string("Ā"),"ascii","custom",meter,undefined)).toThrow(ExecutionLimitError);
});

it.each(["u8","utf","cp65001","646","cp367","latin","l1","cp819","utf-8-sig","utf-16-le","utf-32-be","utf-7"])("routes %s through an explicit encoder even when a native kernel exists",encoding=>{
  const {meter,v}=fixture(),source=v.string("A"),result=v.bytes([7]);
  const fallback=vi.fn(()=>result),encode=createRuntimeUtf8Encoder(v,fallback);
  expect(encode(source,encoding,undefined,meter,undefined)).toBe(result);
  expect(fallback).toHaveBeenCalledExactlyOnceWith(source,encoding,undefined,meter,undefined);
});

it.each(["u8","latin","utf-8-sig","utf-16-le"])("resolves an explicit encoder for empty %s input",encoding=>{
  const {meter,v}=fixture(),source=v.string(""),result=v.bytes([7]);
  const fallback=vi.fn(()=>result),encode=createRuntimeUtf8Encoder(v,fallback);
  expect(encode(source,encoding,"custom",meter,undefined)).toBe(result);
  expect(fallback).toHaveBeenCalledExactlyOnceWith(source,encoding,"custom",meter,undefined);
});

it.each(["utf-8","ascii","latin-1","utf-16","utf-32"])("preserves the native %s shortcut with an explicit encoder",encoding=>{
  const {meter,v,encode:native}=fixture(),fallback=vi.fn(()=>{throw Error("unexpected registry lookup");});
  const source=v.string("A");
  expect(createRuntimeUtf8Encoder(v,fallback)(source,encoding,undefined,meter,undefined)).toEqual(native(source,encoding,undefined,meter,undefined));
  expect(fallback).not.toHaveBeenCalled();
});

it("propagates failures from the explicit encoder without a native retry",()=>{
  const {meter,v}=fixture(),failure=new Error("encoder failed"),fallback=vi.fn(()=>{throw failure;});
  expect(()=>createRuntimeUtf8Encoder(v,fallback)(v.string("A"),"u8",undefined,meter,undefined)).toThrow(failure);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it.each([false,true])("keeps cancellation terminal in a native-alias encoder (throws=%s)",throws=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),v=new RuntimeValues(meter),source=v.string("A"),result=v.bytes([7]);
  const fallback=vi.fn(()=>{controller.abort();if(throws)throw Error("encoder failed");return result;});
  expect(()=>createRuntimeUtf8Encoder(v,fallback)(source,"u8",undefined,meter,undefined)).toThrow(ExecutionLimitError);
  expect(fallback).toHaveBeenCalledTimes(1);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});
