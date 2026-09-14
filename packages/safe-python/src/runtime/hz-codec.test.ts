import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {hzCodec} from "./hz-codec.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const text=(value:string)=>CodePointString.fromString(value,meter());
const bytes=(value:string)=>Uint8Array.from(value,c=>c.charCodeAt(0));

it("encodes GB2312 shifts, ASCII tilde, line endings and directional mappings",()=>{
  expect(hzCodec.encode(text("中~A文\n・―"),"strict",meter())).toEqual(bytes("~{VP~}~~A~{ND~}\n~{!$!*~}"));
  expect([...hzCodec.decode(bytes("~{VP~}~~A~\n~{ND~}"),"strict",meter()).text]).toEqual([...text("中~A文")]);
});

it("preserves shift state across every byte and character split",()=>{
  const source=text("中~A文\n"),encoded=hzCodec.encode(source,"strict",meter());
  for(let split=0;split<=encoded.length;split++){
    const decoder=new DoubleByteIncrementalDecoder(hzCodec);
    const first=decoder.decode(encoded.slice(0,split),false,meter());
    const state=decoder.getstate(meter()),other=new DoubleByteIncrementalDecoder(hzCodec);
    other.setstate(state,meter());
    expect([...first,...other.decode(encoded.slice(split),true,meter())]).toEqual([...source]);
  }
  for(let split=0;split<=source.length;split++){
    const encoder=new DoubleByteIncrementalEncoder(hzCodec);
    const first=encoder.encode(source.slice(0n,BigInt(split),null,meter()),false,meter());
    const state=encoder.getstate(meter()),other=new DoubleByteIncrementalEncoder(hzCodec);
    other.setstate(state,meter());
    expect([...first,...other.encode(source.slice(BigInt(split),null,null,meter()),true,meter())]).toEqual([...encoded]);
  }
});

it("distinguishes immediate high-byte faults from incomplete escape and GB pairs",()=>{
  for(const input of [Uint8Array.of(255),bytes("~{\xff")]){
    expect(()=>hzCodec.decode(input,"strict",meter(),false)).toThrow(expect.objectContaining({reason:"illegal multibyte sequence",end:input.length}));
  }
  for(const input of [bytes("~"),bytes("~{V")]){
    const result=hzCodec.decode(input,"strict",meter(),false);
    expect(result.consumed).toBe(input.length-1);
    expect(()=>hzCodec.decode(input,"strict",meter())).toThrow(expect.objectContaining({start:input.length-1,end:input.length,reason:"incomplete multibyte sequence"}));
  }
});

it("retains noncanonical native mode bytes and resets only the low state byte",()=>{
  const decoder=new DoubleByteIncrementalDecoder(hzCodec);
  decoder.setstate([new Uint8Array(),0x123402n],meter());
  expect([...decoder.decode(bytes("VP"),true,meter())]).toEqual([...text("中")]);
  expect(()=>decoder.decode(bytes("~}"),true,meter())).toThrow(expect.objectContaining({start:0,end:1}));
  expect(decoder.getstate(meter())[1]).toBe(0x123402n);
  decoder.reset(meter());
  expect(decoder.getstate(meter())).toEqual([new Uint8Array(),0x123400n]);
  const encoder=new DoubleByteIncrementalEncoder(hzCodec);
  encoder.setstate(0x12340200n,meter());
  expect(encoder.encode(text("中"),false,meter())).toEqual(bytes("VP"));
  expect(encoder.encode(text(""),true,meter())).toEqual(bytes("~}"));
  expect(encoder.getstate(meter())).toBe(0x12340000n);
});

it("keeps decoder shift state after finalization and encoder shift state after failure",()=>{
  const decoder=new DoubleByteIncrementalDecoder(hzCodec);
  expect([...decoder.decode(bytes("~{VP"),true,meter())]).toEqual([...text("中")]);
  expect(decoder.getstate(meter())[1]).toBe(1n);
  const encoder=new DoubleByteIncrementalEncoder(hzCodec);
  expect(()=>encoder.encode(text("中\ud800"),true,meter())).toThrow(expect.objectContaining({start:1,end:2}));
  expect(encoder.getstate(meter())).toBe(256n);
  expect(encoder.encode(text("文"),true,meter())).toEqual(bytes("ND~}"));
});

it("encodes replace in the active state and leaves ignore in that state",()=>{
  expect(hzCodec.encode(text("中😀文"),"ignore",meter())).toEqual(bytes("~{VPND~}"));
  expect(hzCodec.encode(text("中😀文"),"replace",meter())).toEqual(bytes("~{VP~}?~{ND~}"));
});

it("encodes text recovery without resetting and preserves raw replacement bytes",()=>{
  expect(hzCodec.encode(text("中😀文"),()=>({replacement:text("・"),position:-1n}),meter())).toEqual(bytes("~{VP!$ND~}"));
  expect(hzCodec.encode(text("中😀文"),()=>({replacement:bytes("~}"),position:-1n}),meter())).toEqual(bytes("~{VP~}ND~}"));
  expect(()=>hzCodec.encode(text("中😀文"),()=>({replacement:text("A\ud800"),position:99n}),meter())).toThrow(expect.objectContaining({start:1,end:2,reason:"illegal multibyte sequence"}));
});

it("resumes recovery against original bytes and keeps callback state mutations",()=>{
  const decoder=new DoubleByteIncrementalDecoder(hzCodec,error=>{
    error.object.fill(65);
    decoder.setstate([new Uint8Array(),1n],meter());
    return {replacement:text("?"),position:-2n};
  });
  expect([...decoder.decode(bytes("\xffVP"),true,meter())]).toEqual([...text("?中")]);
  expect(decoder.getstate(meter())[1]).toBe(1n);
});

it.each([false,true])("observes cancellation after stateful recovery return or throw (%s)",throws=>{
  for(const operation of ["encode","decode"] as const){
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:160000,signal:controller.signal});
    const cancel=()=>{controller.abort();if(throws)throw new Error("guest failure");return {replacement:text("?"),position:2n};};
    expect(()=>operation==="encode"?hzCodec.encode(text("中😀"),cancel,budget):hzCodec.decode(bytes("~{\xff"),cancel,budget)).toThrow(expect.objectContaining({reason:"cancelled"}));
    expect(()=>hzCodec.encode(text(""),"strict",budget)).toThrow(ExecutionLimitError);
  }
});

it("propagates guest failure identity and bounds nonprogressing callbacks",()=>{
  const failure=new Error("guest failure");
  expect(()=>hzCodec.encode(text("中😀"),()=>{throw failure;},meter())).toThrow(failure);
  expect(()=>hzCodec.decode(bytes("~{\xff"),()=>{throw failure;},meter())).toThrow(failure);
  expect(()=>hzCodec.decode(bytes("~}"),()=>({replacement:text(""),position:0n}),new ExecutionBudget({maxSteps:100,maxAllocatedBytes:16000}))).toThrow(ExecutionLimitError);
});
