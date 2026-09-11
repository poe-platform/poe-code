import {expect,it,vi} from "vitest";
import {createRuntimeUtf8Encoder} from "./runtime-utf8-encoding.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);return {meter,v,encode:createRuntimeUtf8Encoder(v)};}
it.each(["utf-8","UTF8"," utf---8 ","u8","utf8_ucs2","utf8_ucs4","cp65001"])("encodes UTF-8 alias %s",encoding=>{
  const {meter,v,encode}=fixture();expect(encode(v.string("🐍").value,encoding,"strict",meter,undefined)).toEqual(v.bytes(new Uint8Array([240,159,144,141])));
});
it.each([["ignore",[]],["replace",[63]],["surrogateescape",[128]],["surrogatepass",[237,178,128]],["backslashreplace",[92,117,100,99,56,48]],["namereplace",[92,117,100,99,56,48]],["xmlcharrefreplace",[38,35,53,54,52,52,56,59]]] as const)("uses encoding error handler %s",(errors,bytes)=>{
  const {meter,v,encode}=fixture();expect(encode(v.string("\udc80").value,"utf-8",errors,meter,undefined)).toEqual(v.bytes(new Uint8Array(bytes)));
});
it("resolves codec names even for empty input but looks up error handlers lazily",()=>{
  const {meter,v,encode}=fixture();
  expect(()=>encode(v.string("").value,"unknown","strict",meter,undefined)).toThrow("unknown encoding: unknown");
  expect(encode(v.string("valid").value,"utf-8","unknown",meter,undefined)).toEqual(v.bytes(new Uint8Array([118,97,108,105,100])));
  expect(()=>encode(v.string("\ud800").value,"utf-8","unknown",meter,undefined)).toThrow("unknown error handler name 'unknown'");
});
it("delegates unsupported codecs and custom error handling with original inputs",()=>{
  const {meter,v}=fixture(),fallback=vi.fn(()=>v.bytes(new Uint8Array([7]))),encode=createRuntimeUtf8Encoder(v,fallback),text=v.string("\ud800").value;
  encode(text,"Custom Codec","custom",meter,undefined);expect(fallback).toHaveBeenLastCalledWith(text,"Custom Codec","custom",meter,undefined);
  encode(text,"UTF-8","custom",meter,undefined);expect(fallback).toHaveBeenLastCalledWith(text,"UTF-8","custom",meter,undefined);
});
it.each([false,true])("preserves cancellation from encoding extensions (throws=%s)",throws=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>createRuntimeUtf8Encoder(v,()=>{controller.abort();if(throws)throw Error("extension failed");return v.none;})(v.string("x").value,"custom","strict",meter,undefined)).toThrow(ExecutionLimitError);
});
