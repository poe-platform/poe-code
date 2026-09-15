import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {Gb2312IncrementalDecoder} from "./gb2312-incremental.js";
import {lookupGb2312Pair} from "./gb2312-mapping.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});

it("transfers split state for every valid double-byte mapping",()=>{
  let count=0;
  for(let a=0xa1;a<=0xfe;a++)for(let b=0xa1;b<=0xfe;b++){
    const point=lookupGb2312Pair(a,b);
    if(point===undefined)continue;
    const budget=meter(),decoder=new Gb2312IncrementalDecoder();
    expect([...decoder.decode(Uint8Array.of(65,a),false,budget)]).toEqual([65]);
    const state=decoder.getstate(budget),copy=new Gb2312IncrementalDecoder();
    copy.setstate(state,budget);
    state[0][0]=255;
    expect([...copy.decode(Uint8Array.of(b,0),true,budget)]).toEqual([point,0]);
    expect(copy.getstate(budget)).toEqual([new Uint8Array(),0n]);
    expect(decoder.getstate(budget)).toEqual([Uint8Array.of(a),0n]);
    count++;
  }
  expect(count).toBe(7445);
});

it("clears previous pending bytes on illegal sequence failure",()=>{
  const decoder=new Gb2312IncrementalDecoder(),budget=meter();
  decoder.decode(Uint8Array.of(0xa1),false,budget);
  expect(()=>decoder.decode(Uint8Array.of(65),true,budget)).toThrow(expect.objectContaining({reason:"illegal multibyte sequence",start:0,end:1}));
  expect(decoder.getstate(budget)).toEqual([new Uint8Array(),0n]);
  expect([...decoder.decode(Uint8Array.of(66),true,budget)]).toEqual([66]);
});

it("restores previous pending bytes when final incomplete recovery fails",()=>{
  const decoder=new Gb2312IncrementalDecoder(),budget=meter();
  decoder.decode(Uint8Array.of(0xa1),false,budget);
  expect(()=>decoder.decode(new Uint8Array(),true,budget)).toThrow(expect.objectContaining({reason:"incomplete multibyte sequence"}));
  expect(decoder.getstate(budget)).toEqual([Uint8Array.of(0xa1),0n]);
  expect([...decoder.decode(Uint8Array.of(0xa1),true,budget)]).toEqual([0x3000]);
});

it.each([false,true])("preserves the native state transition for callback failure at final tail (%s)",incomplete=>{
  const budget=meter(),failure=new Error("guest failure");
  const decoder=new Gb2312IncrementalDecoder(()=>{throw failure;});
  decoder.decode(Uint8Array.of(0xa1),false,budget);
  expect(()=>decoder.decode(incomplete?new Uint8Array():Uint8Array.of(65),true,budget)).toThrow(failure);
  expect(decoder.getstate(budget)).toEqual([incomplete?Uint8Array.of(0xa1):new Uint8Array(),0n]);
});

it("performs a final incomplete recovery once, retaining its backward position",()=>{
  const budget=meter();let calls=0;
  const decoder=new Gb2312IncrementalDecoder(()=>{
    calls++;
    return {replacement:CodePointString.fromString("?",budget),position:0n};
  });
  decoder.decode(Uint8Array.of(65,0xa1),false,budget);
  expect([...decoder.decode(new Uint8Array(),true,budget)]).toEqual([63]);
  expect(calls).toBe(1);
  expect(decoder.getstate(budget)).toEqual([Uint8Array.of(0xa1),0n]);
});

it("preserves opaque uint64 state through decoding and reset, with owned bytes",()=>{
  const decoder=new Gb2312IncrementalDecoder(),budget=meter(),pending=Uint8Array.of(65,66);
  decoder.setstate([pending,0xffffffffffffffffn],budget);
  pending[0]=255;
  expect([...decoder.decode(new Uint8Array(),true,budget)]).toEqual([65,66]);
  expect(decoder.getstate(budget)).toEqual([new Uint8Array(),0xffffffffffffffffn]);
  decoder.setstate([Uint8Array.of(0xa1),42n],budget);
  decoder.reset(budget);
  expect(decoder.getstate(budget)).toEqual([new Uint8Array(),42n]);
});

it("validates state overflow before pending capacity without changing state",()=>{
  const decoder=new Gb2312IncrementalDecoder(),budget=meter();
  decoder.setstate([Uint8Array.of(65),42n],budget);
  for(const [value,message] of [[-1n,"can't convert negative int to unsigned"],[1n<<64n,"int too big to convert"]] as const){
    expect(()=>decoder.setstate([new Uint8Array(9),value],budget)).toThrow(expect.objectContaining({name:"OverflowError",message}));
    expect(decoder.getstate(budget)).toEqual([Uint8Array.of(65),42n]);
  }
  expect(()=>decoder.setstate([new Uint8Array(9),0n],budget)).toThrow(expect.objectContaining({name:"UnicodeDecodeError",start:0,end:9,reason:"pending buffer too large"}));
  expect(decoder.getstate(budget)).toEqual([Uint8Array.of(65),42n]);
});

it("observes cancellation before retained state access or mutation",()=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
  const decoder=new Gb2312IncrementalDecoder();
  decoder.decode(Uint8Array.of(0xa1),false,budget);
  controller.abort();
  for(const run of [()=>decoder.decode(new Uint8Array(),true,budget),()=>decoder.getstate(budget),()=>decoder.setstate([new Uint8Array(),0n],budget),()=>decoder.reset(budget)])expect(run).toThrow(ExecutionLimitError);
});

it.each([65,0xa1])("retains callback-installed pending state before appending the outer tail (%s)",last=>{
  const budget=meter();
  const decoder=new Gb2312IncrementalDecoder(error=>{
    decoder.setstate([Uint8Array.of(0xa2),42n],budget);
    return {replacement:CodePointString.fromString("?",budget),position:BigInt(error.end)};
  });
  expect([...decoder.decode(Uint8Array.of(255,last),false,budget)]).toEqual(last===65?[63,65]:[63]);
  expect(decoder.getstate(budget)).toEqual([last===65?Uint8Array.of(0xa2):Uint8Array.of(0xa2,0xa1),42n]);
});

it("reports full input and preserves callback state on pending-buffer overflow",()=>{
  const budget=meter(),pending=Uint8Array.of(65,66,67,68,69,70,71,72),input=Uint8Array.of(255,0xa1);
  const decoder=new Gb2312IncrementalDecoder(error=>{
    decoder.setstate([pending,42n],budget);
    return {replacement:CodePointString.fromString("?",budget),position:BigInt(error.end)};
  });
  expect(()=>decoder.decode(input,false,budget)).toThrow(expect.objectContaining({name:"UnicodeDecodeError",object:input,start:0,end:2,reason:"pending buffer overflow"}));
  expect(decoder.getstate(budget)).toEqual([pending,42n]);
});

it("rereads errors after a callback changes the incremental policy",()=>{
  const budget=meter(),calls:number[]=[];
  const decoder=new Gb2312IncrementalDecoder(error=>{
    calls.push(error.start);
    decoder.errors="replace";
    return {replacement:CodePointString.fromString("X",budget),position:BigInt(error.end)};
  });
  expect([...decoder.decode(Uint8Array.of(255,255,65),true,budget)]).toEqual([88,0xfffd,65]);
  expect(calls).toEqual([0]);
  expect(decoder.errors).toBe("replace");
});
