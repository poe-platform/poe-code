import {expect,it} from "vitest";
import {encodeSingleByte} from "./single-byte-encode.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";
import type {Utf8EncodeRecovery} from "./utf8-encode.js";

function fixture(signal?:AbortSignal){const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:1000000,signal}),values=new RuntimeValues(meter);return {meter,values};}

it.each(["ascii","latin-1"] as const)("resumes %s encoding through explicit recovery with original source spans",encoding=>{
  const {meter,values}=fixture(),source=values.string("AĀ🐍Z").value,events:unknown[]=[];
  const recover:Utf8EncodeRecovery=error=>{
    events.push([error.encoding,error.object===source,error.start,error.end,error.reason]);
    return {replacement:new Uint8Array([255,0]),position:3};
  };
  expect([...encodeSingleByte(source,encoding,recover,meter)]).toEqual([65,255,0,90]);
  expect(events).toEqual([[encoding,true,1,3,`ordinal not in range(${encoding==="ascii"?128:256})`]]);
});
it.each(["ascii","latin-1"] as const)("validates %s replacement text without recursively recovering",encoding=>{
  const {meter,values}=fixture(),failure=new Error("original guest exception");let calls=0,rejections=0;
  const recover:Utf8EncodeRecovery=()=>{calls++;return {replacement:values.string("Ā").value,position:1,failure,rejectReplacement:()=>{rejections++;throw failure;}};};
  expect(()=>encodeSingleByte(values.string("Ā").value,encoding,recover,meter)).toThrow(failure);
  expect([calls,rejections]).toEqual([1,1]);
});
it("encodes replacement text under the selected single-byte range",()=>{
  const {meter,values}=fixture();
  expect([...encodeSingleByte(values.string("ĀZ").value,"latin-1",()=>({replacement:values.string("é").value,position:1}),meter)]).toEqual([233,90]);
});
it.each([false,true])("cancellation dominates single-byte recovery (throws=%s)",throws=>{
  const controller=new AbortController(),{meter,values}=fixture(controller.signal);
  expect(()=>encodeSingleByte(values.string("Ā").value,"ascii",()=>{controller.abort();if(throws)throw Error("guest failure");return {replacement:values.string("").value,position:1};},meter)).toThrow(ExecutionLimitError);
});
it("preserves recovery failures",()=>{
  const {meter,values}=fixture(),failure=new Error("guest failure");
  expect(()=>encodeSingleByte(values.string("Ā").value,"ascii",()=>{throw failure;},meter)).toThrow(failure);
});
it("meters backwards recovery instead of allowing an unbounded loop",()=>{
  const {meter,values}=fixture(),replacement=values.string("").value;
  expect(()=>encodeSingleByte(values.string("Ā").value,"ascii",()=>({replacement,position:0}),meter)).toThrow(ExecutionLimitError);
});
