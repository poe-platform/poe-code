import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {hkscsCodec} from "./hkscs-codec.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const text=(value:string)=>CodePointString.fromString(value,meter());

it.each([
  ["\u00ca\u0304",[0x88,0x62]],["\u00ca\u030c",[0x88,0x64]],
  ["\u00ea\u0304",[0x88,0xa3]],["\u00ea\u030c",[0x88,0xa5]]
] as const)("encodes and decodes sequence %s across every split and state transfer",(source,bytes)=>{
  expect([...hkscsCodec.encode(text(source),"strict",meter())]).toEqual(bytes);
  expect([...hkscsCodec.decode(Uint8Array.from(bytes),"strict",meter()).text]).toEqual([...text(source)]);
  for(let split=0;split<=source.length;split++){
    const encoder=new DoubleByteIncrementalEncoder(hkscsCodec);
    const first=encoder.encode(text(source.slice(0,split)),false,meter());
    const replay=new DoubleByteIncrementalEncoder(hkscsCodec);replay.setstate(encoder.getstate(meter()),meter());
    for(const instance of [encoder,replay]){
      expect([...first,...instance.encode(text(source.slice(split)),true,meter())]).toEqual(bytes);
      expect(instance.getstate(meter())).toBe(0n);
    }
  }
  for(let split=0;split<=bytes.length;split++){
    const decoder=new DoubleByteIncrementalDecoder(hkscsCodec);
    const first=decoder.decode(Uint8Array.from(bytes.slice(0,split)),false,meter());
    const replay=new DoubleByteIncrementalDecoder(hkscsCodec);replay.setstate(decoder.getstate(meter()),meter());
    for(const instance of [decoder,replay])expect([...first,...instance.decode(Uint8Array.from(bytes.slice(split)),true,meter())]).toEqual([...text(source)]);
  }
});

it.each([["\u00ca",[0x88,0x66],0x8ac302n],["\u00ea",[0x88,0xa7],0xaac302n]] as const)("buffers %s until final or a nonmatching next character",(source,bytes,state)=>{
  const encoder=new DoubleByteIncrementalEncoder(hkscsCodec);
  expect([...encoder.encode(text(source),false,meter())]).toEqual([]);
  expect(encoder.getstate(meter())).toBe(state);
  expect([...encoder.encode(text(""),false,meter())]).toEqual([]);
  expect(encoder.getstate(meter())).toBe(state);
  expect([...encoder.encode(text(""),true,meter())]).toEqual(bytes);
  expect([...encoder.encode(text(source+"A"),false,meter())]).toEqual([...bytes,65]);
  encoder.encode(text(source),false,meter());encoder.reset(meter());
  expect(encoder.getstate(meter())).toBe(0n);
});

it("flushes replacement sequences independently and validates negative resumes",()=>{
  const source=text("\ud800\u00ca\u0304");
  expect([...hkscsCodec.encode(source,error=>{
    expect(error.object).toBe(source);
    return {replacement:text("\u00ea"),position:-2n};
  },meter())]).toEqual([0x88,0xa7,0x88,0x62]);
  expect([...hkscsCodec.decode(Uint8Array.of(255,0x88,0x62),()=>({replacement:text("\ud800"),position:-2n}),meter()).text]).toEqual([0xd800,0xca,0x304]);
});

it("restores pending prefixes on failures and replaces callback state with unconsumed text",()=>{
  const encoder=new DoubleByteIncrementalEncoder(hkscsCodec),failure=Error("guest failure");
  encoder.encode(text("\u00ca"),false,meter());
  encoder.errors=()=>{encoder.setstate(0x4101n,meter());throw failure;};
  expect(()=>encoder.encode(text("\ud800"),false,meter())).toThrow(failure);
  expect(encoder.getstate(meter())).toBe(0x8ac302n);
  encoder.errors=()=>{encoder.setstate(0x4101n,meter());return {replacement:Uint8Array.of(63),position:2n};};
  expect([...encoder.encode(text("\ud800\u00ea"),false,meter())]).toEqual([0x88,0x66,63]);
  expect(encoder.getstate(meter())).toBe(0xaac302n);
});

it.each([false,true])("keeps prefix recovery cancellation terminal (throws=%s)",throws=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const encoder=new DoubleByteIncrementalEncoder(hkscsCodec);
  encoder.encode(text("\u00ca"),false,budget);
  encoder.errors=()=>{controller.abort();if(throws)throw Error("guest failure");return {replacement:text("?"),position:2n};};
  expect(()=>encoder.encode(text("\ud800"),false,budget)).toThrow(ExecutionLimitError);
  expect(()=>encoder.getstate(budget)).toThrow(ExecutionLimitError);
  expect(()=>encoder.reset(budget)).toThrow(ExecutionLimitError);
});
