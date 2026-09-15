import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {Gb2312IncrementalEncoder} from "./gb2312-incremental-encoder.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});

it("round trips the native little-endian pending UTF-8 and opaque state format",()=>{
  const budget=meter(),encoder=new Gb2312IncrementalEncoder();
  // Three UTF-8 bytes for 中, followed by eight opaque state bytes.
  const state=3n|(0xadb8e4n<<8n)|(42n<<32n);
  encoder.setstate(state,budget);
  expect(encoder.getstate(budget)).toBe(state);
  expect([...encoder.encode(CodePointString.fromString("A",budget),budget)]).toEqual([0xd6,0xd0,65]);
  expect(encoder.getstate(budget)).toBe(42n<<8n);
  encoder.reset(budget);
  expect(encoder.getstate(budget)).toBe(42n<<8n);
});

it("accepts eight pending ASCII bytes and ignores unused high state bytes",()=>{
  const budget=meter(),encoder=new Gb2312IncrementalEncoder();
  encoder.setstate(8n,budget);
  expect([...encoder.encode(CodePointString.fromString("A",budget),budget)]).toEqual([0,0,0,0,0,0,0,0,65]);
  encoder.setstate(1n<<135n,budget);
  expect(encoder.getstate(budget)).toBe(0n);
});

it("validates conversion width, pending length and UTF-8 in native order",()=>{
  const budget=meter(),encoder=new Gb2312IncrementalEncoder();
  encoder.setstate(42n<<8n,budget);
  for(const [state,name,message] of [
    [-1n,"OverflowError","can't convert negative int to unsigned"],
    [(1n<<136n)|255n,"OverflowError","int too big to convert"],
    [255n,"UnicodeError","pending buffer too large"]
  ] as const){
    expect(()=>encoder.setstate(state,budget)).toThrow(expect.objectContaining({name,message}));
    expect(encoder.getstate(budget)).toBe(42n<<8n);
  }
  expect(()=>encoder.setstate(1n|(255n<<8n),budget)).toThrow(expect.objectContaining({name:"UnicodeDecodeError",encoding:"utf-8",start:0,end:1,reason:"invalid start byte"}));
  expect(encoder.getstate(budget)).toBe(42n<<8n);
});

it("restores pending text after an encoding failure and allows retry",()=>{
  const budget=meter(),encoder=new Gb2312IncrementalEncoder();
  encoder.setstate(1n|(65n<<8n),budget);
  expect(()=>encoder.encode(CodePointString.fromString("😀",budget),budget)).toThrow(expect.objectContaining({name:"UnicodeEncodeError",start:1,end:2}));
  expect(encoder.getstate(budget)).toBe(1n|(65n<<8n));
  expect([...encoder.encode(CodePointString.fromString("中",budget),budget)]).toEqual([65,0xd6,0xd0]);
  expect(encoder.getstate(budget)).toBe(0n);
});

it("retains callback-installed pending text on success, but restores it on failure",()=>{
  const budget=meter();let fail=false;
  const encoder=new Gb2312IncrementalEncoder(error=>{
    encoder.setstate(1n|(66n<<8n)|(42n<<16n),budget);
    if(fail)throw new Error("guest failure");
    return {replacement:Uint8Array.of(63),position:BigInt(error.end)};
  });
  expect([...encoder.encode(CodePointString.fromString("😀",budget),budget)]).toEqual([63]);
  expect(encoder.getstate(budget)).toBe(1n|(66n<<8n)|(42n<<16n));
  encoder.setstate(1n|(65n<<8n),budget);fail=true;
  expect(()=>encoder.encode(CodePointString.fromString("😀",budget),budget)).toThrow("guest failure");
  expect(encoder.getstate(budget)).toBe(1n|(65n<<8n)|(42n<<16n));
});

it("checks retained state operations after cancellation",()=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
  const encoder=new Gb2312IncrementalEncoder(),input=CodePointString.fromString("",budget);
  controller.abort();
  for(const run of [()=>encoder.getstate(budget),()=>encoder.setstate(0n,budget),()=>encoder.reset(budget),()=>encoder.encode(input,budget)])expect(run).toThrow(ExecutionLimitError);
});
