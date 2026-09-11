import {expect,it,vi} from "vitest";
import {createRuntimeTextDecoder} from "./runtime-text-decoding.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);return {meter,v,decode:createRuntimeTextDecoder(v)};}
it.each(["ascii","US-ASCII","646","ANSI_X3.4-1968","cp367"])("decodes ASCII alias %s",encoding=>{
  const {meter,v,decode}=fixture();expect(decode(v.bytes(new Uint8Array([0,65,127])).value,encoding,"strict",meter,undefined)).toEqual(v.stringPoints(new Uint32Array([0,65,127])));
});
it.each(["latin-1","latin1","ISO-8859-1","cp819","l1","latin","iso_8859_1_1987"])("decodes all Latin-1 bytes under %s without looking up error handlers",encoding=>{
  const {meter,v,decode}=fixture(),bytes=Uint8Array.from({length:256},(_,i)=>i);
  expect(decode(v.bytes(bytes).value,encoding,"unknown",meter,undefined)).toEqual(v.stringPoints(Uint32Array.from(bytes)));
});
it.each([["ignore",[65]],["replace",[65,0xfffd,0xfffd]],["surrogateescape",[65,0xdcff,0xdc80]],["backslashreplace",[65,92,120,102,102,92,120,56,48]]] as const)("handles malformed ASCII with %s",(errors,points)=>{
  const {meter,v,decode}=fixture();expect(decode(v.bytes(new Uint8Array([65,255,128])).value,"ascii",errors,meter,undefined)).toEqual(v.stringPoints(new Uint32Array(points)));
});
it.each(["strict","surrogatepass"])("retains ASCII decode failure metadata for %s",errors=>{
  const {meter,v,decode}=fixture();let failure:unknown;
  try{decode(v.bytes(new Uint8Array([65,255,128])).value,"ascii",errors,meter,undefined);}catch(error){failure=error;}
  expect(failure).toMatchObject({name:"UnicodeDecodeError",message:"'ascii' codec can't decode byte 0xff in position 1: ordinal not in range(128)",encoding:"ascii",start:1,end:2,object:new Uint8Array([65,255,128])});
});
it("looks up custom ASCII error handlers only on malformed input",()=>{
  const {meter,v}=fixture(),fallback=vi.fn(()=>v.string("custom")),decode=createRuntimeTextDecoder(v,fallback);
  expect(decode(v.bytes(new Uint8Array([65])).value,"ascii","custom",meter,undefined)).toEqual(v.string("A"));expect(fallback).not.toHaveBeenCalled();
  expect(decode(v.bytes(new Uint8Array([255])).value,"ascii","custom",meter,undefined)).toEqual(v.string("custom"));expect(fallback).toHaveBeenCalledTimes(1);
});
it("retains UTF-8 decoding and explicit fallback for other codecs",()=>{
  const {meter,v}=fixture(),fallback=vi.fn(()=>v.string("custom")),decode=createRuntimeTextDecoder(v,fallback);
  expect(decode(v.bytes(new Uint8Array([0xc3,0xa9])).value,"utf-8","strict",meter,undefined)).toEqual(v.string("é"));expect(fallback).not.toHaveBeenCalled();
  expect(decode(v.bytes(new Uint8Array([120])).value,"custom","strict",meter,undefined)).toEqual(v.string("custom"));
});
it.each([false,true])("preserves cancellation from custom ASCII error handling (throws=%s)",throws=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),bytes=v.bytes(new Uint8Array([255])).value;
  const decode=createRuntimeTextDecoder(v,()=>{controller.abort();if(throws)throw Error("handler failed");return v.none;});
  expect(()=>decode(bytes,"ascii","custom",meter,undefined)).toThrow(ExecutionLimitError);
});
it("charges output storage before decoding Latin-1",()=>{
  const {v,decode}=fixture(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0}),bytes=v.bytes(new Uint8Array([255])).value;
  expect(()=>decode(bytes,"latin-1","strict",meter,undefined)).toThrow(ExecutionLimitError);
});
