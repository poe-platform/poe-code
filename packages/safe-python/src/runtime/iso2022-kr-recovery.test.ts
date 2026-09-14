import {expect,it} from "vitest";
import evidence from "./__snapshots__/iso2022-kr-recovery-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {PythonDecodeError} from "./decode-error.js";
import type {PythonEncodeError} from "./encode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";

const meter=()=>new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
const text=(input:string)=>CodePointString.fromString(input,meter());
const input=Uint8Array.of(27,36,41,67,14,255,48,33);

it.each(evidence.rows.map((row,index)=>({...row,index})))("matches recovery return, negative position and failure state $index",row=>{
  const budget=meter(),events:unknown[]=[];
  const recover=(error:PythonDecodeError|PythonEncodeError)=>{
    events.push([row.kind==="encode"?"UnicodeEncodeError":"UnicodeDecodeError",[...error.object],Number(error.start),Number(error.end),error.reason]);
    if(events.length>1)throw new PythonRuntimeError("ValueError","repeat");
    return {replacement:new CodePointString(Uint32Array.from(row.replacement),budget),position:BigInt(row.position)};
  };
  const encoder=new DoubleByteIncrementalEncoder(iso2022KrCodec,error=>{
    const result=recover(error);
    return {...result,replacement:row.raw?Uint8Array.from(row.replacement):result.replacement};
  }),decoder=new DoubleByteIncrementalDecoder(iso2022KrCodec,recover);
  let result:unknown;
  try{result=["ok",[...(row.kind==="encode"?encoder.encode(text("가😀나"),true,budget):decoder.decode(input,true,budget))]];}
  catch(error){if(!(error instanceof PythonRuntimeError))throw error;result=["error",error.name,error.message];}
  const [pending,state]=decoder.getstate(budget);
  expect({events,result,state:row.kind==="encode"?String(encoder.getstate(budget)):[[...pending],String(state)]}).toEqual({events:row.events,result:row.result,state:row.state});
});

it.each([false,true])("keeps cancellation terminal after recovery return or throw (%s)",throws=>{
  for(const operation of ["encode","decode"] as const){
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const recover=()=>{controller.abort();if(throws)throw new PythonRuntimeError("ValueError","guest failed");return {replacement:text("?"),position:-1n};};
    expect(()=>operation==="encode"?iso2022KrCodec.encode(text("가😀나"),recover,budget):iso2022KrCodec.decode(input,recover,budget)).toThrow(expect.objectContaining({reason:"cancelled"}));
    expect(()=>iso2022KrCodec.encode(text(""),"strict",budget)).toThrow(ExecutionLimitError);
  }
});

it("restores pending escape and designation state at every split",()=>{
  const budget=meter(),source=text("가나다A"),encoded=iso2022KrCodec.encode(source,"strict",budget);
  for(let split=0;split<=encoded.length;split++){
    const first=new DoubleByteIncrementalDecoder(iso2022KrCodec),restored=new DoubleByteIncrementalDecoder(iso2022KrCodec);
    const prefix=first.decode(encoded.slice(0,split),false,budget);
    restored.setstate(first.getstate(budget),budget);
    expect([...prefix,...restored.decode(encoded.slice(split),true,budget)]).toEqual([...source]);
  }
  for(let split=0;split<=source.length;split++){
    const first=new DoubleByteIncrementalEncoder(iso2022KrCodec),restored=new DoubleByteIncrementalEncoder(iso2022KrCodec);
    const prefix=first.encode(source.slice(0n,BigInt(split),null,budget),false,budget);
    restored.setstate(first.getstate(budget),budget);
    expect([...prefix,...restored.encode(source.slice(BigInt(split),null,null,budget),true,budget)]).toEqual([...encoded]);
  }
});

// CPython 3.14.7 oracle: callbacks share the active native designation state;
// resetting or reentering changes the outer operation before replacement text.
it.each(["reset","reenter"] as const)("retains shared encoder and decoder state after callback %s",action=>{
  const budget=meter(),nested:unknown[]=[];
  const encoder=new DoubleByteIncrementalEncoder(iso2022KrCodec,()=>{
    if(action==="reset")encoder.reset(budget);
    else nested.push([...encoder.encode(text("A"),false,budget)]);
    return {replacement:text("?"),position:-1n};
  });
  expect([...encoder.encode(text("가😀나"),true,budget)]).toEqual([27,36,41,67,14,48,33,63,14,51,42,15]);
  expect(encoder.getstate(budget)).toBe(12796416n);
  const decoder=new DoubleByteIncrementalDecoder(iso2022KrCodec,()=>{
    if(action==="reset")decoder.reset(budget);
    else nested.push([...decoder.decode(Uint8Array.of(15,65),false,budget)]);
    return {replacement:text("?"),position:-2n};
  });
  expect([...decoder.decode(input,true,budget)]).toEqual([63,48,33]);
  expect(decoder.getstate(budget)).toEqual([new Uint8Array(),4375362n]);
  expect(nested).toEqual(action==="reset"?[]:[[15,65],[65]]);
});
