import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeGb2312,encodeGb2312} from "./gb2312-codec.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const string=(text:string)=>CodePointString.fromString(text,meter());

// CPython 3.14.7 / Unicode 16.0.0. Each ordered high-leading byte pair
// contributes one compact JSON result plus LF. No Python runs in these tests.
it.each([
  ["strict","03fa4e0e6eb057153da0bde3c9f58564dd3557899180f56c0e3f2821214048a0"],
  ["ignore","dcf387b8b25573672422e6a4ee2c408637850e1bd3a501138745a48818b6a091"],
  ["replace","e6b1ef323538c6e248b54435b11208aa89ebd5a5903652b50717622a0ad2aee4"]
] as const)("matches every high-leading byte pair with %s",(errors,digest)=>{
  const hash=createHash("sha256");
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    let row:unknown;
    try{
      const result=decodeGb2312(Uint8Array.of(first,second),errors,meter());
      row=["ok",[...result.text],result.consumed];
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      row=["error",error.start,error.end,error.reason];
    }
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(digest);
});

it("defers every trailing high byte, including invalid leading bytes",()=>{
  for(let byte=128;byte<256;byte++){
    const input=Uint8Array.of(65,byte);
    const result=decodeGb2312(input,"strict",meter(),false);
    expect([...result.text]).toEqual([65]);
    expect(result.consumed).toBe(1);
    expect(()=>decodeGb2312(input,"strict",meter())).toThrow(expect.objectContaining({start:1,end:2,reason:"incomplete multibyte sequence"}));
  }
});

it("round trips ASCII, GB2312-specific mappings and embedded zero",()=>{
  const input=string("A\0中é・―");
  const bytes=encodeGb2312(input,"strict",meter());
  expect([...bytes]).toEqual([65,0,0xd6,0xd0,0xa8,0xa6,0xa1,0xa4,0xa1,0xaa]);
  expect([...decodeGb2312(bytes,"strict",meter()).text]).toEqual([...input]);
});

it("recovers one unmappable point at a time, preserving separate surrogates",()=>{
  const input=new CodePointString(Uint32Array.of(0x1f600,0xd800,0xdc80,0xb7,0x2014));
  const seen:number[][]=[];
  const encoded=encodeGb2312(input,error=>{
    expect(error.object).toBe(input);
    expect(error.reason).toBe("illegal multibyte sequence");
    seen.push([error.start,error.end]);
    return {replacement:string("中"),position:BigInt(error.end)};
  },meter());
  expect([...encoded]).toEqual([0xd6,0xd0,0xd6,0xd0,0xd6,0xd0,0xd6,0xd0,0xd6,0xd0]);
  expect(seen).toEqual([[0,1],[1,2],[2,3],[3,4],[4,5]]);
  expect([...encodeGb2312(input,"ignore",meter())]).toEqual([]);
  expect([...encodeGb2312(input,"replace",meter())]).toEqual([63,63,63,63,63]);
});

it("keeps original decoder input after callback exception-object mutation",()=>{
  const input=Uint8Array.of(255,65);
  const result=decodeGb2312(input,error=>{
    error.object.fill(66);
    return {replacement:string("?"),position:-1n};
  },meter());
  expect([...result.text]).toEqual([63,65]);
  expect([...input]).toEqual([255,65]);
  expect(result.consumed).toBe(2);
});

it("encodes replacement text strictly before checking its resume position",()=>{
  const replacement=string("😀");
  expect(()=>encodeGb2312(string("·"),()=>({replacement,position:1n<<70n}),meter()))
    .toThrow(expect.objectContaining({object:replacement,start:0,end:1,reason:"illegal multibyte sequence"}));
  expect([...encodeGb2312(string("·A"),()=>({replacement:Uint8Array.of(255),position:-1n}),meter())]).toEqual([255,65]);
});

it.each([[-4n,"-1"],[4n,"4"],[-(1n<<70n),"-1"],[1n<<70n,"-1"]])("validates native resume position %s",(position,display)=>{
  const expected={name:"IndexError",message:`position ${display} from error handler out of bounds`};
  expect(()=>decodeGb2312(Uint8Array.of(255,65,66),()=>({replacement:string("?"),position}),meter())).toThrow(expect.objectContaining(expected));
  expect(()=>encodeGb2312(string("😀AB"),()=>({replacement:string("?"),position}),meter())).toThrow(expect.objectContaining(expected));
});

it("allows bounded backward resume and reports original consumed length",()=>{
  let calls=0;
  const result=decodeGb2312(Uint8Array.of(255,65),()=>({replacement:string("?"),position:++calls===1?0n:1n}),meter());
  expect([...result.text]).toEqual([63,63,65]);
  expect(result.consumed).toBe(2);
});

it("propagates callback failures and terminates non-progressing recovery",()=>{
  const failure=new Error("guest callback failure");
  expect(()=>decodeGb2312(Uint8Array.of(255),()=>{throw failure;},meter())).toThrow(failure);
  expect(()=>encodeGb2312(string("😀"),()=>{throw failure;},meter())).toThrow(failure);
  const budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:16000});
  expect(()=>decodeGb2312(Uint8Array.of(255),()=>({replacement:string(""),position:0n}),budget)).toThrow(ExecutionLimitError);
});

it.each([false,true])("cancellation wins over callback return or throw (%s)",throws=>{
  const controller=new AbortController();
  const budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
  const failure=new Error("guest failure after cancellation");
  expect(()=>decodeGb2312(Uint8Array.of(255),()=>{
    controller.abort();
    if(throws)throw failure;
    return {replacement:string("?"),position:1n};
  },budget)).toThrow(expect.objectContaining({reason:"cancelled"}));
  expect(()=>encodeGb2312(string(""),"strict",budget)).toThrow(ExecutionLimitError);
  expect(()=>decodeGb2312(new Uint8Array(),"strict",budget)).toThrow(ExecutionLimitError);
});

it("retains strict encoder error bounds for non-BMP and surrogate inputs",()=>{
  for(const point of [0x80,0xd800,0xdcff,0xffff,0x10000,0x10ffff]){
    const input=new CodePointString(Uint32Array.of(65,point,point));
    expect(()=>encodeGb2312(input,"strict",meter())).toThrow(PythonEncodeError);
    expect(()=>encodeGb2312(input,"strict",meter())).toThrow(expect.objectContaining({start:1,end:2,object:input}));
  }
});

it.each([
  ["ignore",15018,"711305b272914821588ceeecc92a54339071b0639ccae16c15c5d47fca72b5b8"],
  ["replace",1121557,"5684ff3272a79ae14273ccde06d990cea1dec9bf2f87f13c150df62b7f1d76f4"]
] as const)("matches every Unicode point through the %s encoder",(errors,length,digest)=>{
  const budget=new ExecutionBudget({maxSteps:16000000,maxAllocatedBytes:64000000});
  const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
  const result=encodeGb2312(input,errors,budget);
  expect(result.length).toBe(length);
  expect(createHash("sha256").update(result).digest("hex")).toBe(digest);
});

it.each([false,true])("encoder callback cancellation wins over return or throw (%s)",throws=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
  expect(()=>encodeGb2312(string("😀"),()=>{
    controller.abort();
    if(throws)throw new Error("guest failure");
    return {replacement:Uint8Array.of(63),position:1n};
  },budget)).toThrow(expect.objectContaining({reason:"cancelled"}));
});

it("terminates output growth and backward encoder recovery with a latched failure",()=>{
  const budget=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:1000});
  const replacement=string("x".repeat(200));
  expect(()=>encodeGb2312(string("😀"),()=>({replacement,position:0n}),budget)).toThrow(expect.objectContaining({reason:"allocation"}));
  expect(()=>decodeGb2312(new Uint8Array(),"strict",budget)).toThrow(expect.objectContaining({reason:"allocation"}));
});
