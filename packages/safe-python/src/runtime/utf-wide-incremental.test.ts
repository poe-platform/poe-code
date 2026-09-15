import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {encodeWideUnicode} from "./utf-wide.js";
import {WideUnicodeDecoder,WideUnicodeEncoder} from "./utf-wide-incremental.js";

const text=(...points:number[])=>new CodePointString(new Uint32Array(points));

it.each([16,32] as const)("preserves reentrant byte-order changes from UTF-%i recovery",width=>{
  for(const initial of [0n,1n,2n]){
    const decoder=new WideUnicodeDecoder(width,0,error=>{
      decoder.setstate([new Uint8Array([81]),1n]);
      return {replacement:text(63),position:error.end,input:error.object};
    });
    decoder.setstate([new Uint8Array(),initial]);
    const input=initial===2n?new Uint8Array([0]):width===32?new Uint8Array([255,255,255,255]):new Uint8Array(initial===0n?[0,220]:[220,0]);
    expect([...decoder.decode(input,true)]).toEqual([63]);
    expect(decoder.getstate()).toEqual([new Uint8Array(),1n]);
    expect([...decoder.decode(encodeWideUnicode(text(65),width,1),true)]).toEqual([65]);
  }
});

it.each([16,32] as const)("finishes initial UTF-%i BOM detection after reentrant recovery",width=>{
  for(const bom of [false,true]){
    const decoder=new WideUnicodeDecoder(width,0,error=>{
      decoder.setstate([new Uint8Array([81]),1n]);
      return {replacement:text(63),position:error.end,input:error.object};
    });
    const input=encodeWideUnicode(text(0xdc00),width,bom?0:-1,"surrogatepass");
    if(bom){
      expect([...decoder.decode(input,true)]).toEqual([63]);
      expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
    }else{
      expect(()=>decoder.decode(input,true)).toThrow(expect.objectContaining({encoding:`utf-${width}`,start:0,end:width/8,reason:"Stream does not start with BOM"}));
      expect(decoder.getstate()).toEqual([new Uint8Array([81]),1n]);
    }
  }
});

it.each([16,32] as const)("preserves reentrant UTF-%i encoder reset after initial selection",width=>{
  for(const started of [false,true]){
    const encoder=new WideUnicodeEncoder(width,0,error=>{
      encoder.reset();
      return {replacement:text(63),position:error.end};
    });
    if(started)encoder.encode(text());
    expect(encoder.encode(text(0xd800))).toEqual(encodeWideUnicode(text(63),width,started?-1:0));
    expect(encoder.getstate()).toBe(started?2n:0n);
    expect(encoder.encode(text(65))).toEqual(encodeWideUnicode(text(65),width,started?0:-1));
  }
});

it.each([16,32] as const)("retains UTF-%i callback mutations when recovery raises or cancels",width=>{
  for(const operation of ["encode","decode"])for(const cancelled of [false,true]){
    const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:10000,signal:controller.signal});
    const decoder=new WideUnicodeDecoder(width),encoder=new WideUnicodeEncoder(width),failure=new Error("guest failure");
    encoder.encode(text());
    const recover=()=>{
      decoder.setstate([new Uint8Array([81]),1n]);encoder.reset();
      if(cancelled)controller.abort();
      throw failure;
    };
    decoder.errors=recover;encoder.errors=recover;
    expect(()=>operation==="decode"?decoder.decode(new Uint8Array([0]),true,meter):encoder.encode(text(0xd800),true,meter)).toThrow(cancelled?ExecutionLimitError:failure);
    expect(decoder.getstate()).toEqual([new Uint8Array([81]),1n]);
    expect(encoder.getstate()).toBe(2n);
  }
});

it.each([16,32] as const)("preserves every split, endian selection and owned state for UTF-%i",width=>{
  for(const order of [-1,0,1] as const){
    const input=encodeWideUnicode(text(65,0x20ac,0x1f600,0xfeff),width,order);
    for(let split=0;split<=input.length;split++){
      const decoder=new WideUnicodeDecoder(width,order);
      const first=decoder.decode(input.slice(0,split));
      const state=decoder.getstate(),restored=new WideUnicodeDecoder(width,order);
      restored.setstate(state);state[0].fill(255);
      expect([...first,...decoder.decode(input.slice(split),true)]).toEqual([65,0x20ac,0x1f600,0xfeff]);
      expect([...first,...restored.decode(input.slice(split),true)]).toEqual([65,0x20ac,0x1f600,0xfeff]);
      expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
      decoder.reset();expect(decoder.getstate()[1]).toBe(order===0?2n:0n);
    }
  }
});

it.each([16,32] as const)("requires a BOM only for native incremental UTF-%i and leaves failures uncommitted",width=>{
  const decoder=new WideUnicodeDecoder(width),input=encodeWideUnicode(text(65),width,-1);
  expect(()=>decoder.decode(input,true)).toThrow(expect.objectContaining({encoding:`utf-${width}`,start:0,end:width/8,reason:"Stream does not start with BOM"}));
  expect(decoder.getstate()).toEqual([new Uint8Array(),2n]);
  const invalid=encodeWideUnicode(text(0xd800),width,0,"surrogatepass");
  decoder.decode(invalid.slice(0,1));
  expect(()=>decoder.decode(invalid.slice(1),true)).toThrow(expect.objectContaining({encoding:`utf-${width}-le`}));
  expect(decoder.getstate()).toEqual([invalid.slice(0,1),2n]);
  decoder.errors="surrogatepass";
  expect([...decoder.decode(invalid.slice(1),true)]).toEqual([0xd800]);
  expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
});

it.each([16,32] as const)("normalizes internal integer state and emits BOM only after successful UTF-%i encode",width=>{
  const encoder=new WideUnicodeEncoder(width);
  expect(encoder.getstate()).toBe(2n);
  expect(()=>encoder.encode(text(0xd800))).toThrow();expect(encoder.getstate()).toBe(2n);
  expect(encoder.encode(text())).toEqual(encodeWideUnicode(text(),width));
  expect(encoder.getstate()).toBe(0n);
  expect(encoder.encode(text(65))).toEqual(encodeWideUnicode(text(65),width,-1));
  for(const state of [-3n,-1n,0n,1n,2n,3n,9n]){
    encoder.setstate(state);expect(encoder.getstate()).toBe(state===0n?0n:2n);
    const decoder=new WideUnicodeDecoder(width);decoder.setstate([new Uint8Array(),state]);
    expect(decoder.getstate()[1]).toBe(state===0n||state===1n?state:2n);
    for(const order of [-1,1] as const){
      const fixed=new WideUnicodeDecoder(width,order),fixedEncoder=new WideUnicodeEncoder(width,order);
      fixed.setstate([new Uint8Array(),state]);fixedEncoder.setstate(state);
      expect(fixed.getstate()[1]).toBe(0n);expect(fixedEncoder.getstate()).toBe(0n);
    }
  }
  encoder.reset();expect(encoder.getstate()).toBe(2n);
});

it("observes cancellation before mutation and budgets output storage",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:10000,signal:controller.signal});
  const encoder=new WideUnicodeEncoder(16),decoder=new WideUnicodeDecoder(32);
  controller.abort();
  expect(()=>encoder.encode(text(),false,meter)).toThrow(ExecutionLimitError);
  expect(()=>decoder.decode(new Uint8Array(),false,meter)).toThrow(ExecutionLimitError);
  expect(encoder.getstate()).toBe(2n);expect(decoder.getstate()[1]).toBe(2n);
  expect(()=>encodeWideUnicode(text(65),32,0,"strict",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});

it.each([16,32] as const)("detects a big-endian BOM at every split for native UTF-%i",width=>{
  const input=encodeWideUnicode(text(0xfeff,0x1f600,65),width,1);
  for(let split=0;split<=input.length;split++){
    const decoder=new WideUnicodeDecoder(width);
    expect([...decoder.decode(input.slice(0,split)),...decoder.decode(input.slice(split),true)]).toEqual([0x1f600,65]);
    expect(decoder.getstate()).toEqual([new Uint8Array(),1n]);
  }
});

it("supports recovery across buffered input, including a replacement longer than the original bytes",()=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:10000});
  const decoder=new WideUnicodeDecoder(16,-1,()=>({replacement:text(63),position:0,input:new Uint8Array([65,0,66,0])}));
  expect([...decoder.decode(new Uint8Array([0]))]).toEqual([]);
  expect([...decoder.decode(new Uint8Array([0xdc]),true,meter)]).toEqual([63,65,66]);
  expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
  const encoder=new WideUnicodeEncoder(16,0,()=>({replacement:text(65),position:1}));
  expect(encoder.encode(text(0xd800))).toEqual(new Uint8Array([255,254,65,0]));
  expect(encoder.getstate()).toBe(0n);
});
