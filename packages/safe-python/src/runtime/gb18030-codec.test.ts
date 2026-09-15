import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {gb18030Codec} from "./gb18030-codec.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const text=(value:string)=>CodePointString.fromString(value,meter());

it("encodes one-, two- and four-byte mappings and retains all split prefixes",()=>{
  const input=text('A\u0080中\u{10000}Z'),encoded=gb18030Codec.encode(input,"strict",meter());
  expect([...encoded]).toEqual([65,129,48,129,48,214,208,144,48,129,48,90]);
  for(let split=0;split<=encoded.length;split++){
    const decoder=new DoubleByteIncrementalDecoder(gb18030Codec);
    const first=decoder.decode(encoded.subarray(0,split),false,meter());
    const state=decoder.getstate(meter());
    const replay=new DoubleByteIncrementalDecoder(gb18030Codec);replay.setstate(state,meter());
    expect([...first,...decoder.decode(encoded.subarray(split),true,meter())]).toEqual([...input]);
    expect([...first,...replay.decode(encoded.subarray(split),true,meter())]).toEqual([...input]);
  }
});

it("recognizes truncated digit-prefixed quads before invalid byte checks",()=>{
  for(const input of [Uint8Array.of(255,48),Uint8Array.of(255,48,255),Uint8Array.of(129,48,0)]){
    expect(gb18030Codec.decode(input,"strict",meter(),false).consumed).toBe(0);
    expect(()=>gb18030Codec.decode(input,"strict",meter())).toThrow(expect.objectContaining({encoding:"gb18030",start:0,end:input.length,reason:"incomplete multibyte sequence"}));
  }
});

it("retains input, accepts negative resumes and strictly encodes replacement text first",()=>{
  const source=text('\ud800A'),seen:number[][]=[];
  expect([...gb18030Codec.encode(source,error=>{
    expect(error.object).toBe(source);seen.push([error.start,error.end]);
    return {replacement:text('\u0080'),position:-1n};
  },meter())]).toEqual([129,48,129,48,65]);
  expect(seen).toEqual([[0,1]]);
  const input=Uint8Array.of(255,65);
  expect([...gb18030Codec.decode(input,error=>{
    error.object.fill(66);return {replacement:text('?'),position:-1n};
  },meter()).text]).toEqual([63,65]);
  expect([...input]).toEqual([255,65]);
  const replacement=text('\udfff');
  expect(()=>gb18030Codec.encode(source,()=>({replacement,position:1n<<70n}),meter())).toThrow(expect.objectContaining({encoding:"gb18030",object:replacement,start:0,end:1,reason:"illegal multibyte sequence"}));
});

it.each([-4n,4n,-(1n<<70n),1n<<70n])("validates recovery position %s",position=>{
  const display=position===-4n?-1n:position===4n?4n:-1n;
  const failure=expect.objectContaining({name:"IndexError",message:`position ${display} from error handler out of bounds`});
  expect(()=>gb18030Codec.encode(text('\ud800AB'),()=>({replacement:Uint8Array.of(255),position}),meter())).toThrow(failure);
  expect(()=>gb18030Codec.decode(Uint8Array.of(255,65,66),()=>({replacement:text('?'),position}),meter())).toThrow(failure);
});

it.each([false,true])("preserves fatal cancellation when callbacks throw=%s",throws=>{
  for(const operation of ["encode","decode"] as const){
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
    const replacement=text('?'),failure=Error('guest failure');
    const cancel=()=>{controller.abort();if(throws)throw failure;return {replacement,position:1n};};
    expect(()=>operation==="encode"?gb18030Codec.encode(text('\ud800'),cancel,budget):gb18030Codec.decode(Uint8Array.of(255),cancel,budget)).toThrow(ExecutionLimitError);
    expect(()=>gb18030Codec.encode(text('A'),"strict",budget)).toThrow(ExecutionLimitError);
  }
});

it("propagates callback failures and restores injected encoder pending text",()=>{
  const failure=Error('guest failure'),encoder=new DoubleByteIncrementalEncoder(gb18030Codec,()=>{throw failure;});
  encoder.setstate(0x4101n,meter());
  expect(()=>encoder.encode(text('\ud800'),false,meter())).toThrow(failure);
  expect(encoder.getstate(meter())).toBe(0x4101n);
  encoder.errors="strict";
  expect([...encoder.encode(text('\u0080'),true,meter())]).toEqual([65,129,48,129,48]);
  expect(encoder.getstate(meter())).toBe(0n);
});

function* corpus():Generator<Uint8Array> {
  for(let a=128;a<256;a++)for(let b=0;b<256;b++)yield Uint8Array.of(a,b);
  for(const a of [128,129,132,133,143,144,227,228,254,255])for(const b of [47,48,49,57,58])for(const c of [0,128,129,254,255])for(let d=0;d<256;d++)yield Uint8Array.of(a,b,c,d);
  for(const input of [[129],[129,48],[129,48,129],[255,48],[255,48,255]])yield Uint8Array.from(input);
}

it.each([
  ["strict","ebacb8274d1c375c3a5a1db2035001646bff9e98e1cbd7cd63525f43038b72a9"],
  ["ignore","6e75fdb06cfb91fea98284572ec0949c26342943476f418d3ce02e175a142f4c"],
  ["replace","c83c6cc94590100edd3201a413c824ac070714c34bdc9683500253a9dc284d1b"]
] as const)("matches 96,773 native decoder records under %s",(errors,digest)=>{
  const hash=createHash("sha256");let count=0;
  for(const input of corpus()){
    let row:unknown;count++;
    try{const result=gb18030Codec.decode(input,errors,meter());row=["ok",[...result.text],result.consumed];}
    catch(error){if(!(error instanceof PythonDecodeError))throw error;row=["error",error.start,error.end,error.reason];}
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(count).toBe(96773);
  expect(hash.digest("hex")).toBe(digest);
});

it.each([
  ["ignore",4399992,"764df5e1bec4261b6eaf68b7344e44b48661ac1ca27b824d8dfc72e41ccb210d"],
  ["replace",4402040,"83a07c336c34aa672546bda6072ace8a56378dc53bb4ba160df3a2d12f140caa"]
] as const)("matches full-Unicode %s encoding",(errors,length,digest)=>{
  const budget=new ExecutionBudget({maxSteps:40000000,maxAllocatedBytes:100000000});
  const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
  const output=gb18030Codec.encode(input,errors,budget);
  expect(output.length).toBe(length);
  expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
});

it.each([
  ["strict","0179018e175dcaa4723acf3674ead54fd4f9460bf32cfcdd39e51c13fb648d5c"],
  ["ignore","18827dce90a24733ba120c8bf35f214d626685018a09816ead8738145608dafc"],
  ["replace","d07ced3b5cbb7ab6a8eee736370cfb2d47831fef88471123a3f6b46621c45a77"]
] as const)("matches incremental output, fault objects and state for %s",(errors,digest)=>{
  const hash=createHash("sha256");let count=0;
  for(const data of [[65,129,48,129,48,214,208,144,48,129,48,90],[255,48,255],[129,48,129],[132,49,165,48],[255,65],[227,50,154,54]]){
    const input=Uint8Array.from(data);
    for(let split=0;split<=input.length;split++){
      count++;const decoder=new DoubleByteIncrementalDecoder(gb18030Codec,errors),row:unknown[]=[];
      for(const [chunk,final] of [[input.subarray(0,split),false],[input.subarray(split),true]] as const){
        try{row.push(["ok",[...decoder.decode(chunk,final,meter())]]);}
        catch(error){if(!(error instanceof PythonDecodeError))throw error;row.push(["error",[...error.object],error.start,error.end,error.reason]);}
        const [pending,state]=decoder.getstate(meter());row.push([[...pending],Number(state)]);
      }
      hash.update(JSON.stringify(row)+"\n");
    }
  }
  expect(count).toBe(34);
  expect(hash.digest("hex")).toBe(digest);
});
