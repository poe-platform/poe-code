import {expect,it} from "vitest";
import {decodeSingleByte} from "./single-byte-decode.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";

function fixture(signal?:AbortSignal){const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:1000000,signal}),values=new RuntimeValues(meter);return {meter,values};}
it.each(["ascii","latin-1"] as const)("decodes the %s byte domain",encoding=>{
  const {meter}=fixture(),input=Uint8Array.from({length:encoding==="ascii"?128:256},(_,i)=>i);
  const result=decodeSingleByte(input,encoding,"strict",meter);
  expect([...result.text]).toEqual([...input]);expect(result.consumed).toBe(input.length);
});
it.each([["ignore",[65]],["replace",[65533,65533,65]],["surrogateescape",[56575,56574,65]],["backslashreplace",[92,120,102,102,92,120,102,101,65]]] as const)("implements ASCII %s policy",(errors,points)=>{
  const {meter}=fixture();expect([...decodeSingleByte(new Uint8Array([255,254,65]),"ascii",errors,meter).text]).toEqual(points);
});
it.each(["strict","surrogatepass"] as const)("reports one undefined ASCII byte for %s",errors=>{
  const {meter}=fixture();expect(()=>decodeSingleByte(new Uint8Array([65,255,254]),"ascii",errors,meter)).toThrow(expect.objectContaining({encoding:"ascii",start:1,end:2,reason:"ordinal not in range(128)"}));
});
it.each([[],[88,89,90],[255,81]].map(replacement=>({replacement})))("reports original consumption after callback input replacement: $replacement",({replacement})=>{
  const {meter,values}=fixture(),events:unknown[]=[];
  const result=decodeSingleByte(new Uint8Array([255,254,65]),"ascii",error=>{
    events.push([error.start,error.end,error.reason,[...error.object]]);
    return {replacement:values.string("?").value,input:Uint8Array.from(replacement),position:replacement.length};
  },meter);
  expect([...result.text]).toEqual([63]);expect(result.consumed).toBe(3);
  expect(events).toEqual([[0,1,"ordinal not in range(128)",[255,254,65]]]);
});
it("revisits replacement input at the validated resume position",()=>{
  const {meter,values}=fixture(),input=new Uint8Array([255,65]);let calls=0;
  const result=decodeSingleByte(input,"ascii",()=>({replacement:values.string("?").value,input:new Uint8Array([88,89,90]),position:++calls}),meter);
  expect([...result.text]).toEqual([63,89,90]);expect(result.consumed).toBe(2);expect(calls).toBe(1);expect([...input]).toEqual([255,65]);
});
it.each([false,true])("cancellation dominates decoder callbacks (throws=%s)",throws=>{
  const controller=new AbortController(),{meter,values}=fixture(controller.signal),replacement=values.string("").value;
  expect(()=>decodeSingleByte(new Uint8Array([255]),"ascii",()=>{controller.abort();if(throws)throw Error("guest failure");return {replacement,input:new Uint8Array(),position:0};},meter)).toThrow(ExecutionLimitError);
});
it("preserves failures and bounds backwards recovery",()=>{
  const {meter,values}=fixture(),failure=new Error("guest failure"),input=new Uint8Array([255]);
  expect(()=>decodeSingleByte(input,"ascii",()=>{throw failure;},meter)).toThrow(failure);
  const replacement=values.string("").value;
  expect(()=>decodeSingleByte(input,"ascii",()=>({replacement,input,position:0}),meter)).toThrow(ExecutionLimitError);
});
