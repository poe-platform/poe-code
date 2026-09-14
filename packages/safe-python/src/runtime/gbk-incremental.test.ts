import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {GbkIncrementalDecoder,GbkIncrementalEncoder} from "./gbk-incremental.js";
import {Gb2312IncrementalEncoder} from "./gb2312-incremental.js";
import {lookupGbkPair} from "./gbk-mapping.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {taiwanCodecs} from "./taiwan-codec.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
// Native state is a byte count, UTF-8 pending text and eight opaque bytes,
// serialized as an unsigned little-endian integer (CPython 3.14.7).
function encoderState(bytes:readonly number[],opaque=42n):bigint {
  let state=opaque;
  for(let index=bytes.length-1;index>=0;index--)state=(state<<8n)|BigInt(bytes[index]);
  return (state<<8n)|BigInt(bytes.length);
}

it("transfers owned GBK pending bytes across every valid mapping",()=>{
  let count=0;
  for(let a=128;a<256;a++)for(let b=0;b<256;b++){
    const point=lookupGbkPair(a,b);
    if(point===undefined)continue;
    const budget=meter(),decoder=new GbkIncrementalDecoder();
    expect([...decoder.decode(Uint8Array.of(65,a),false,budget)]).toEqual([65]);
    const state=decoder.getstate(budget),copy=new GbkIncrementalDecoder();
    copy.setstate(state,budget);state[0][0]=0;
    expect([...copy.decode(Uint8Array.of(b,0),true,budget)]).toEqual([point,0]);
    expect(copy.getstate(budget)).toEqual([new Uint8Array(),0n]);
    expect(decoder.getstate(budget)).toEqual([Uint8Array.of(a),0n]);
    count++;
  }
  expect(count).toBe(21791);
});

it.each([
  ["strict","b7f7896d17f5093994d45d8b6382dfd29f096fa4795e939fa3c529973f02e8a2"],
  ["ignore","67a33239051eed390c0ded98351add371d1156d45f5905d3e60c91db71950135"],
  ["replace","7b3601c86b3f6e4c9acaeadfcdaeac88b991b91438a28da7a637ec0705a0ed8a"]
] as const)("matches every high-leading split pair and post-final state with %s",(policy,digest)=>{
  const hash=createHash("sha256");
  for(let a=128;a<256;a++)for(let b=0;b<256;b++){
    const budget=meter(),decoder=new GbkIncrementalDecoder(policy);
    const first=[...decoder.decode(Uint8Array.of(a),false,budget)];let result:unknown;
    try{result=["ok",[...decoder.decode(Uint8Array.of(b),true,budget)]];}
    catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      result=["error",error.encoding,[...error.object],error.start,error.end,error.reason];
    }
    const [pending,opaque]=decoder.getstate(budget);
    hash.update(JSON.stringify([first,result,[...pending],String(opaque)])+"\n");
  }
  expect(hash.digest("hex")).toBe(digest);
});

it("retains every high-byte tail on strict final failure and flushes with replacement",()=>{
  for(let byte=128;byte<256;byte++){
    const budget=meter(),decoder=new GbkIncrementalDecoder();
    expect([...decoder.decode(Uint8Array.of(byte),false,budget)]).toEqual([]);
    expect(()=>decoder.decode(new Uint8Array(),true,budget)).toThrow(expect.objectContaining({encoding:"gbk",start:0,end:1,reason:"incomplete multibyte sequence"}));
    expect(decoder.getstate(budget)).toEqual([Uint8Array.of(byte),0n]);
    decoder.errors="replace";
    expect([...decoder.decode(new Uint8Array(),true,budget)]).toEqual([0xfffd]);
    expect(decoder.getstate(budget)).toEqual([new Uint8Array(),0n]);
  }
});

it.each([false,true])("preserves distinct feed/flush failure state (%s)",flush=>{
  const budget=meter(),failure=new Error("guest failure"),decoder=new GbkIncrementalDecoder(()=>{throw failure;});
  decoder.decode(Uint8Array.of(0x81),false,budget);
  expect(()=>decoder.decode(flush?new Uint8Array():Uint8Array.of(0),true,budget)).toThrow(failure);
  expect(decoder.getstate(budget)).toEqual([flush?Uint8Array.of(0x81):new Uint8Array(),0n]);
});

it("retains reentrant pending state, live errors and a negative flush resume",()=>{
  const budget=meter();let calls=0;
  const decoder=new GbkIncrementalDecoder(error=>{
    calls++;
    decoder.setstate([Uint8Array.of(0x81),42n],budget);
    decoder.errors="replace";
    return {replacement:CodePointString.fromString("?",budget),position:BigInt(error.end)};
  });
  expect([...decoder.decode(Uint8Array.of(255,255,65),false,budget)]).toEqual([63,0xfffd,65]);
  expect(calls).toBe(1);
  expect(decoder.getstate(budget)).toEqual([Uint8Array.of(0x81),42n]);
  decoder.errors=()=>({replacement:CodePointString.fromString("!",budget),position:-1n});
  expect([...decoder.decode(new Uint8Array(),true,budget)]).toEqual([33]);
  expect(decoder.getstate(budget)).toEqual([Uint8Array.of(0x81),42n]);
});

describe.each([
  ["gb2312",Gb2312IncrementalEncoder,[0xd6,0xd0]],
  ["gbk",GbkIncrementalEncoder,[0xd6,0xd0]],
  ["big5",DoubleByteIncrementalEncoder.bind(undefined,taiwanCodecs.big5),[0xa4,0xa4]],
  ["cp950",DoubleByteIncrementalEncoder.bind(undefined,taiwanCodecs.cp950),[0xa4,0xa4]]
] as const)("%s encoder",(_name,Encoder,middleBytes)=>{
  it("matches every 16-bit serialized state against the pinned native oracle",()=>{
    const hash=createHash("sha256");let accepted=0;
    for(let state=0;state<65536;state++){
      const budget=meter(),encoder=new Encoder();encoder.setstate(2769153n,budget);
      let row:unknown;
      try{
        encoder.setstate(BigInt(state),budget);accepted++;
        const before=encoder.getstate(budget);let result:unknown;
        try{result=["ok",[...encoder.encode(CodePointString.fromString("!",budget),true,budget)]];}
        catch(error){
          if(!(error instanceof PythonEncodeError))throw error;
          result=["error",error.name,error.encoding,[...error.object],error.start,error.end,error.reason];
        }
        row=["ok",String(before),result,String(encoder.getstate(budget))];
      }catch(error){
        if(!(error instanceof PythonRuntimeError))throw error;
        row=error instanceof PythonDecodeError
          ?["error",error.name,error.encoding,[...error.object],error.start,error.end,error.reason,String(encoder.getstate(budget))]
          :["error",error.name,error.message,String(encoder.getstate(budget))];
      }
      hash.update(JSON.stringify(row)+"\n");
    }
    expect(accepted).toBe(1280);
    expect(hash.digest("hex")).toBe("2c12d0451ce6ac043c013a0d879cd57047e8cbe29ce15ffb7ef728f8c12ef3aa");
  });

  it("round trips injected UTF-8 pending text and opaque state through final/reset",()=>{
    const budget=meter(),encoder=new Encoder(),text=CodePointString.fromString("!",budget);
    for(const pending of [[65],[65,66,67,68,69,70,71,72],[0xe4,0xb8,0xad]]){
      const state=encoderState(pending);
      encoder.setstate(state,budget);
      expect(encoder.getstate(budget)).toBe(state);
      expect([...encoder.encode(text,true,budget)]).toEqual(pending.length===3?[...middleBytes,33]:[...pending,33]);
      expect(encoder.getstate(budget)).toBe(42n<<8n);
      encoder.setstate(state,budget);encoder.reset(budget);
      expect(encoder.getstate(budget)).toBe(42n<<8n);
    }
  });

  it("validates state before mutation and ignores bytes beyond the declared state",()=>{
    const budget=meter(),encoder=new Encoder(),original=encoderState([65]);
    encoder.setstate(original,budget);
    for(const [state,name,message] of [[-1n,"OverflowError","can't convert negative int to unsigned"],[1n<<136n,"OverflowError","int too big to convert"],[9n,"UnicodeError","pending buffer too large"],[0xff01n,"UnicodeDecodeError","invalid start byte"]] as const){
      expect(()=>encoder.setstate(state,budget)).toThrow(expect.objectContaining({name,...(name==="UnicodeDecodeError"?{reason:message}:{message})}));
      expect(encoder.getstate(budget)).toBe(original);
    }
    encoder.setstate((1n<<128n)|original,budget);
    expect(encoder.getstate(budget)).toBe(original);
  });

  it("restores original pending text on failure but retains callback opaque state",()=>{
    const budget=meter(),failure=new Error("guest failure");
    const encoder=new Encoder(()=>{encoder.setstate(encoderState([66],99n),budget);throw failure;});
    const original=encoderState([0xf0,0x9f,0x98,0x80]);
    encoder.setstate(original,budget);
    expect(()=>encoder.encode(CodePointString.fromString("",budget),false,budget)).toThrow(failure);
    expect(encoder.getstate(budget)).toBe(encoderState([0xf0,0x9f,0x98,0x80],99n));
    encoder.errors="replace";
    expect([...encoder.encode(CodePointString.fromString("A",budget),true,budget)]).toEqual([63,65]);
    expect(encoder.getstate(budget)).toBe(99n<<8n);
  });

  it("captures an operation's error policy while preserving callback-installed pending text",()=>{
    const budget=meter();let calls=0;
    const encoder=new Encoder(error=>{
      calls++;encoder.errors="ignore";encoder.setstate(encoderState([65]),budget);
      return {replacement:Uint8Array.of(33),position:BigInt(error.end)};
    });
    expect([...encoder.encode(new CodePointString(Uint32Array.of(0xd800,0xdfff),budget),true,budget)]).toEqual([33,33]);
    expect(calls).toBe(2);expect(encoder.getstate(budget)).toBe(encoderState([65]));
    expect([...encoder.encode(CodePointString.fromString("B",budget),false,budget)]).toEqual([65,66]);
  });

  it.each([false,true])("keeps callback cancellation terminal (throws=%s)",throws=>{
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
    const encoder=new Encoder(()=>{controller.abort();if(throws)throw new Error("service failure");return {replacement:Uint8Array.of(65),position:-1n};});
    expect(()=>encoder.encode(CodePointString.fromString("\ud800",budget),false,budget)).toThrow(ExecutionLimitError);
    for(const run of [()=>encoder.getstate(budget),()=>encoder.setstate(0n,budget),()=>encoder.reset(budget)])expect(run).toThrow(ExecutionLimitError);
  });
});
