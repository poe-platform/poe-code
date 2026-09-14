import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import oracle from "./__snapshots__/johab-kernel-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {johabCodec} from "./johab-codec.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const string=(text:string)=>CodePointString.fromString(text,meter());
function failure(error:unknown):unknown[] {
  if(!(error instanceof PythonDecodeError)&&!(error instanceof PythonEncodeError))throw error;
  return ["error",error.encoding,[...error.object],error.start,error.end,error.reason];
}

it("pins the external reference and preserves non-bijective filler and jamo spellings",()=>{
  expect(oracle.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(oracle.reference).toMatchObject({unicode:"16.0.0",platform:"darwin",byteorder:"little"});
  for(const [bytes,point,canonical] of [
    [[0x84,0x41],0x3000,[0xd9,0x31]],
    [[0xd9,0x31],0x3000,[0xd9,0x31]],
    [[0x84,0x42],0x3131,[0x88,0x41]],
    [[0x88,0x41],0x3131,[0x88,0x41]],
    [[0xda,0xd4],0x3164,[0xda,0xd4]]
  ] as const){
    expect([...johabCodec.decode(Uint8Array.from(bytes),"strict",meter()).text]).toEqual([point]);
    expect([...johabCodec.encode(string(String.fromCodePoint(point)),"strict",meter())]).toEqual(canonical);
  }
});

it.each(["strict","ignore","replace"] as const)("matches every high-leading Johab pair under %s",errors=>{
  const hash=createHash("sha256");
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    let row:unknown;
    try{const result=johabCodec.decode(Uint8Array.of(first,second),errors,meter());row=["ok",[...result.text],result.consumed];}
    catch(error){row=failure(error);}
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(oracle.decode[errors].sha256);
});

function splitRow(data:Uint8Array,split:number,final:boolean,errors:"strict"|"ignore"|"replace"):unknown {
  const budget=meter(),decoder=new DoubleByteIncrementalDecoder(johabCodec,errors);
  const state=()=>{const [pending,flags]=decoder.getstate(budget);return [[...pending],String(flags)];};
  const call=(input:Uint8Array,final:boolean)=>{
    let result:unknown;
    try{result=["ok",[...decoder.decode(input,final,budget)]];}
    catch(error){result=failure(error);}
    return [result,state()];
  };
  decoder.setstate([new Uint8Array(),0x123456789abcdef0n],budget);
  const row=[call(data.subarray(0,split),false),call(data.subarray(split),final),call(new Uint8Array(),true)];
  decoder.reset(budget);row.push(state());return row;
}

it.each(["strict","ignore","replace"] as const)("matches every split byte pair with finalization and opaque state under %s",errors=>{
  const hash=createHash("sha256");
  for(let first=0;first<256;first++)for(let second=0;second<256;second++)for(const final of [false,true]){
    hash.update(JSON.stringify(splitRow(Uint8Array.of(first,second),1,final,errors))+"\n");
  }
  expect(hash.digest("hex")).toBe(oracle.incremental[errors].sha256);
});

it.each(["strict","ignore","replace"] as const)("matches all Hangul composition splits under %s",errors=>{
  const hash=createHash("sha256");let count=0;
  for(let point=0xac00;point<=0xd7a3;point++){
    const bytes=johabCodec.encode(string(String.fromCodePoint(point)),"strict",meter());
    for(let split=0;split<=bytes.length;split++)for(const final of [false,true]){
      hash.update(JSON.stringify(splitRow(bytes,split,final,errors))+"\n");count++;
    }
  }
  expect(count).toBe(oracle.hangul[errors].records);
  expect(hash.digest("hex")).toBe(oracle.hangul[errors].sha256);
});

it.each(Array.from({length:17},(_,plane)=>plane))("matches every strict Unicode encoding and fault in plane %i",plane=>{
  const hash=createHash("sha256");
  for(let point=plane*0x10000;point<(plane+1)*0x10000;point++){
    let row:unknown;
    try{row=["ok",[...johabCodec.encode(string(String.fromCodePoint(point)),"strict",meter())]];}
    catch(error){row=failure(error);}
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(oracle.strictEncode.planes[plane]);
});

it.each(["ignore","replace"] as const)("matches all-point encoding with %s",errors=>{
  const budget=new ExecutionBudget({maxSteps:16000000,maxAllocatedBytes:64000000});
  const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
  const result=johabCodec.encode(input,errors,budget);
  expect(result.length).toBe(oracle.encode[errors].length);
  expect(createHash("sha256").update(result).digest("hex")).toBe(oracle.encode[errors].sha256);
});

it("keeps decoding input immutable and validates negative resumes after replacement encoding",()=>{
  const bytes=Uint8Array.of(255,65),text=string("😀A");
  expect([...johabCodec.decode(bytes,error=>{
    error.object.fill(66);return {replacement:string("갂"),position:-1n};
  },meter()).text]).toEqual([...string("갂A")]);
  expect([...bytes]).toEqual([255,65]);
  const result=johabCodec.encode(text,error=>{
    expect(error.object).toBe(text);return {replacement:string("갂"),position:-1n};
  },meter());
  expect([...result]).toEqual([0x88,0x63,65]);
  const replacement=string("\ud800");
  expect(()=>johabCodec.encode(text,()=>({replacement,position:1n<<70n}),meter()))
    .toThrow(expect.objectContaining({object:replacement,encoding:"johab",start:0,end:1,reason:"illegal multibyte sequence"}));
});

it("retains encoder pending text and flags across guest failure and resets pending input",()=>{
  const budget=meter(),failure=new Error("guest failure"),encoder=new DoubleByteIncrementalEncoder(johabCodec,()=>{throw failure;});
  const state=(0x123456789abcdef0n<<16n)|(65n<<8n)|1n;
  encoder.setstate(state,budget);
  expect(()=>encoder.encode(string("😀"),true,budget)).toThrow(failure);
  expect(encoder.getstate(budget)).toBe(state);
  encoder.errors="replace";
  expect([...encoder.encode(string("😀갂"),false,budget)]).toEqual([65,63,0x88,0x63]);
  expect(encoder.getstate(budget)).toBe(0x123456789abcdef000n);
  encoder.setstate(state,budget);encoder.reset(budget);
  expect(encoder.getstate(budget)).toBe(0x123456789abcdef000n);
});

it.each([false,true])("cancellation supersedes recovery return or guest failure (%s)",throws=>{
  for(const operation of ["encode","decode"]){
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
    const recover=()=>{
      controller.abort();if(throws)throw new Error("guest failure after cancellation");
      return {replacement:string("갂"),position:1n};
    };
    expect(()=>operation==="encode"?johabCodec.encode(string("😀"),recover,budget):johabCodec.decode(Uint8Array.of(255),recover,budget))
      .toThrow(expect.objectContaining({reason:"cancelled"}));
    expect(()=>johabCodec.decode(new Uint8Array(),"strict",budget)).toThrow(ExecutionLimitError);
  }
});
