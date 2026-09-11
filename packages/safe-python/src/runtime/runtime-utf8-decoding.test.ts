import {expect,it,vi} from "vitest";
import {createRuntimeUtf8Decoder} from "./runtime-utf8-decoding.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";
import {constructRuntimeString} from "./runtime-string-construction.js";
import {createRuntimeStringDecoder} from "./runtime-string-decoding.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);return {meter,v,decode:createRuntimeUtf8Decoder(v)};}
it.each(["utf-8","UTF8"," utf---8 ","u8","utf8_ucs2","utf8_ucs4","üutf8","utf8☃éucs2"])("decodes the UTF-8 alias %s",encoding=>{
  const {meter,v,decode}=fixture();expect(decode(v.bytes(new Uint8Array([0xf0,0x9f,0x90,0x8d])).value,encoding,"strict",meter,undefined)).toEqual(v.string("🐍"));
});
it.each([["ignore",[]],["replace",[0xfffd]],["surrogateescape",[0xdcff]],["backslashreplace",[92,120,102,102]]] as const)("uses the %s error handler",(errors,points)=>{
  const {meter,v,decode}=fixture();expect(decode(v.bytes(new Uint8Array([255])).value,"utf-8",errors,meter,undefined)).toEqual(v.stringPoints(new Uint32Array(points)));
});
it("looks up unknown error handlers only when malformed data requires one",()=>{
  const {meter,v,decode}=fixture();
  expect(decode(v.bytes(new Uint8Array([120])).value,"utf-8","unknown",meter,undefined)).toEqual(v.string("x"));
  expect(()=>decode(v.bytes(new Uint8Array([255])).value,"utf-8","unknown",meter,undefined)).toThrow("unknown error handler name 'unknown'");
  expect(()=>decode(v.bytes(new Uint8Array([255])).value,"utf-8","xmlcharrefreplace",meter,undefined)).toThrow("don't know how to handle UnicodeDecodeError in error callback");
});
it("routes unsupported codecs to the explicit fallback without losing names",()=>{
  const {meter,v}=fixture(),fallback=vi.fn(()=>v.string("custom")),decode=createRuntimeUtf8Decoder(v,fallback),bytes=v.bytes(new Uint8Array([120])).value;
  expect(decode(bytes,"Custom Codec","custom-errors",meter,undefined)).toEqual(v.string("custom"));expect(fallback).toHaveBeenCalledWith(bytes,"Custom Codec","custom-errors",meter,undefined);
});
it("skips all codec lookup for empty input",()=>{
  const {meter,v}=fixture(),fallback=vi.fn(()=>v.none),decode=createRuntimeUtf8Decoder(v,fallback);
  expect(decode(v.bytes(new Uint8Array()).value,"unknown","unknown",meter,undefined)).toEqual(v.string(""));expect(fallback).not.toHaveBeenCalled();
});
it("composes native UTF-8 decoding with string construction and buffer admission",()=>{
  const {meter,v,decode}=fixture(),keywords=v.dictionary(new OrderedKeyMap({hash:()=>1n,equal:(a,b)=>a===b},meter));
  expect(constructRuntimeString([v.bytes(new Uint8Array([0xc3,0xa9])),v.string("UTF-8")],keywords,v,meter,{decode:createRuntimeStringDecoder(decode,v)})).toEqual(v.string("é"));
});
it("reports unknown codecs instead of attempting UTF-8",()=>{
  const {meter,v,decode}=fixture();expect(()=>decode(v.bytes(new Uint8Array([120])).value,"UTF.8","strict",meter,undefined)).toThrow("unknown encoding: UTF.8");
});
it("delegates custom error handling only when malformed data requires it",()=>{
  const {meter,v}=fixture(),fallback=vi.fn(()=>v.string("repaired")),decode=createRuntimeUtf8Decoder(v,fallback);
  expect(decode(v.bytes(new Uint8Array([120])).value,"utf-8","custom",meter,undefined)).toEqual(v.string("x"));expect(fallback).not.toHaveBeenCalled();
  expect(decode(v.bytes(new Uint8Array([255])).value,"utf-8","custom",meter,undefined)).toEqual(v.string("repaired"));expect(fallback).toHaveBeenCalledTimes(1);
});
it.each([false,true])("preserves cancellation from codec extensions (throws=%s)",throws=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),bytes=v.bytes(new Uint8Array([120])).value;
  expect(()=>createRuntimeUtf8Decoder(v,()=>{controller.abort();if(throws)throw Error("extension failed");return v.none;})(bytes,"custom","strict",meter,undefined)).toThrow(ExecutionLimitError);
});
