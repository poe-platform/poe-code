import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeGbk,encodeGbk} from "./gbk-codec.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const string=(text:string)=>CodePointString.fromString(text,meter());

// Ordered compact JSON result + LF for every high-leading pair, recorded with
// external CPython 3.14.7 / Unicode 16.0.0. No Python/LLM calls in unit tests.
it.each([
  ["strict","64a4e1ba3246529f62c031769d4707368828fa0f5d78736cc103bcc94b36f99e"],
  ["ignore","5ac6ccd2ad0fe25c3009e8d9feae39494daaf5aa06de88aaffd8dfd7c530f863"],
  ["replace","225edee908c87c9948590d0540a8ed8979f583c31b9a7baaa1b8f09add47d74b"]
] as const)("matches every high-leading GBK pair with %s",(errors,digest)=>{
  const hash=createHash("sha256");
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    let row:unknown;
    try{
      const result=decodeGbk(Uint8Array.of(first,second),errors,meter());
      row=["ok",[...result.text],result.consumed];
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      expect(error.encoding).toBe("gbk");
      row=["error",error.start,error.end,error.reason];
    }
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(digest);
});

it.each([
  ["ignore",43710,"f443cb4e97d2f2004f7cd200a1061edd75a012920d79f9f109ac8cc2db2f59db"],
  ["replace",1135903,"2670bc18cd7ebf5cfd782c7226437e3d4e7a129de6c95ccda20a28b47082b500"]
] as const)("matches every Unicode point through the GBK %s encoder",(errors,length,digest)=>{
  const budget=new ExecutionBudget({maxSteps:16000000,maxAllocatedBytes:64000000});
  const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
  const result=encodeGbk(input,errors,budget);
  expect(result.length).toBe(length);
  expect(createHash("sha256").update(result).digest("hex")).toBe(digest);
});

it("retains every trailing high byte on nonfinal input",()=>{
  for(let byte=128;byte<256;byte++){
    const input=Uint8Array.of(65,byte);
    const result=decodeGbk(input,"strict",meter(),false);
    expect([...result.text]).toEqual([65]);
    expect(result.consumed).toBe(1);
    expect(()=>decodeGbk(input,"strict",meter())).toThrow(expect.objectContaining({encoding:"gbk",start:1,end:2,reason:"incomplete multibyte sequence"}));
  }
});

it("processes every split of mixed ASCII, GBK extension and overridden pairs",()=>{
  const text=string("A\0中丂·—―"),bytes=encodeGbk(text,"strict",meter());
  expect([...bytes]).toEqual([65,0,0xd6,0xd0,0x81,0x40,0xa1,0xa4,0xa1,0xaa,0xa8,0x44]);
  for(let split=0;split<=bytes.length;split++){
    const first=decodeGbk(bytes.subarray(0,split),"strict",meter(),false);
    const last=decodeGbk(bytes.subarray(first.consumed),"strict",meter());
    expect([...first.text,...last.text]).toEqual([...text]);
  }
});

it("recovers individual surrogate/non-BMP faults with original input identity",()=>{
  const input=new CodePointString(Uint32Array.of(0xd800,0xdc80,0x1f600,65)),seen:number[][]=[];
  const result=encodeGbk(input,error=>{
    expect(error.encoding).toBe("gbk");
    expect(error.object).toBe(input);
    seen.push([error.start,error.end]);
    return {replacement:string("·"),position:BigInt(error.end)};
  },meter());
  expect([...result]).toEqual([0xa1,0xa4,0xa1,0xa4,0xa1,0xa4,65]);
  expect(seen).toEqual([[0,1],[1,2],[2,3]]);
});

it("preserves active decode input and accepts negative recovery positions",()=>{
  const input=Uint8Array.of(255,65);
  const result=decodeGbk(input,error=>{
    error.object.fill(66);
    return {replacement:string("?"),position:-1n};
  },meter());
  expect([...result.text]).toEqual([63,65]);
  expect([...input]).toEqual([255,65]);
  expect([...encodeGbk(string("😀A"),()=>({replacement:Uint8Array.of(255),position:-1n}),meter())]).toEqual([255,65]);
});

it("strictly encodes replacement text before validating its position",()=>{
  const replacement=string("€");
  expect(()=>encodeGbk(string("😀"),()=>({replacement,position:1n<<70n}),meter()))
    .toThrow(expect.objectContaining({encoding:"gbk",object:replacement,start:0,end:1,reason:"illegal multibyte sequence"}));
});

it.each([[-4n,"-1"],[4n,"4"],[-(1n<<70n),"-1"],[1n<<70n,"-1"]])("validates GBK recovery position %s",(position,display)=>{
  const expected={name:"IndexError",message:`position ${display} from error handler out of bounds`};
  expect(()=>decodeGbk(Uint8Array.of(255,65,66),()=>({replacement:string("?"),position}),meter())).toThrow(expect.objectContaining(expected));
  expect(()=>encodeGbk(string("😀AB"),()=>({replacement:string("?"),position}),meter())).toThrow(expect.objectContaining(expected));
});

it("propagates callback failures and bounds non-progressing recovery",()=>{
  const failure=new Error("guest callback failure");
  expect(()=>decodeGbk(Uint8Array.of(255),()=>{throw failure;},meter())).toThrow(failure);
  expect(()=>encodeGbk(string("😀"),()=>{throw failure;},meter())).toThrow(failure);
  const budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:16000});
  expect(()=>decodeGbk(Uint8Array.of(255),()=>({replacement:string(""),position:0n}),budget)).toThrow(ExecutionLimitError);
});

it.each([false,true])("cancellation wins over callback return or throw (%s)",throws=>{
  for(const operation of ["encode","decode"]){
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
    const recover=()=>{
      controller.abort();
      if(throws)throw new Error("guest failure after cancellation");
      return {replacement:string("?"),position:1n};
    };
    expect(()=>operation==="encode"?encodeGbk(string("😀"),recover,budget):decodeGbk(Uint8Array.of(255),recover,budget))
      .toThrow(expect.objectContaining({reason:"cancelled"}));
    expect(()=>decodeGbk(new Uint8Array(),"strict",budget)).toThrow(ExecutionLimitError);
  }
});
