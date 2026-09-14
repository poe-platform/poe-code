import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import oracle from "./__snapshots__/cp949-kernel-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {cp949Codec} from "./cp949-codec.js";
import {lookupCp949Character,lookupCp949Pair} from "./cp949-mapping.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const string=(text:string)=>CodePointString.fromString(text,meter());

it("matches all high-leading byte pairs and every Unicode point against independent pinned mappings",()=>{
  const decoded=Buffer.alloc(32768*4),encoded=Buffer.alloc(0x110000*4);
  let decodeCount=0,encodeCount=0;
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    const point=lookupCp949Pair(first,second);
    if(point!==undefined)decodeCount++;
    decoded.writeInt32LE(point??-1,((first-128)*256+second)*4);
  }
  for(let point=0;point<0x110000;point++){
    const bytes=lookupCp949Character(point);
    if(bytes!==undefined)encodeCount++;
    encoded.writeInt32LE(bytes??-1,point*4);
  }
  expect(decodeCount).toBe(oracle.mapping.decode.mapped);
  expect(encodeCount).toBe(oracle.mapping.encode.mapped);
  expect(createHash("sha256").update(decoded).digest("hex")).toBe(oracle.mapping.decode.sha256);
  expect(createHash("sha256").update(encoded).digest("hex")).toBe(oracle.mapping.encode.sha256);
});

function failure(error:unknown):unknown[] {
  if(!(error instanceof PythonDecodeError))throw error;
  return ["error",error.encoding,[...error.object],error.start,error.end,error.reason];
}

it.each(["strict","ignore","replace"] as const)("matches complete high-leading CP949 pair decoding under %s",errors=>{
  const hash=createHash("sha256");
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    let row:unknown;
    try{
      const result=cp949Codec.decode(Uint8Array.of(first,second),errors,meter());
      row=["ok",[...result.text],result.consumed];
    }catch(error){row=failure(error);}
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(oracle.decode[errors].sha256);
});

it.each(["strict","ignore","replace"] as const)("matches every split byte pair and finalization with opaque decoder state under %s",errors=>{
  const hash=createHash("sha256");
  for(let first=0;first<256;first++)for(let second=0;second<256;second++)for(const final of [false,true]){
    const budget=meter(),decoder=new DoubleByteIncrementalDecoder(cp949Codec,errors);
    const state=()=>{const [pending,flags]=decoder.getstate(budget);return [[...pending],String(flags)];};
    const call=(input:Uint8Array,final:boolean)=>{
      let result:unknown;
      try{result=["ok",[...decoder.decode(input,final,budget)]];}
      catch(error){result=failure(error);}
      return [result,state()];
    };
    decoder.setstate([new Uint8Array(),0x123456789abcdef0n],budget);
    const row=[call(Uint8Array.of(first),false),call(Uint8Array.of(second),final),call(new Uint8Array(),true)];
    decoder.reset(budget);
    row.push(state());
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(oracle.incremental[errors].sha256);
});

it.each(["ignore","replace"] as const)("matches all Unicode input including surrogates with %s",errors=>{
  const budget=new ExecutionBudget({maxSteps:16000000,maxAllocatedBytes:64000000});
  const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
  const result=cp949Codec.encode(input,errors,budget);
  expect(result.length).toBe(oracle.encode[errors].length);
  expect(createHash("sha256").update(result).digest("hex")).toBe(oracle.encode[errors].sha256);
});

it("decodes every split across base and extension Hangul without losing input or flags",()=>{
  const input=string("A\0가갂힣한글"),budget=meter(),bytes=cp949Codec.encode(input,"strict",budget);
  expect([...bytes]).toEqual([65,0,0xb0,0xa1,0x81,0x41,0xc6,0x52,0xc7,0xd1,0xb1,0xdb]);
  for(let split=0;split<=bytes.length;split++){
    const decoder=new DoubleByteIncrementalDecoder(cp949Codec);
    expect([...decoder.decode(bytes.subarray(0,split),false,budget),...decoder.decode(bytes.subarray(split),true,budget)]).toEqual([...input]);
  }
});

it("retains original encoding source and strictly encodes custom replacements before resume validation",()=>{
  const input=string("\ud800😀A"),seen:number[][]=[];
  const bytes=cp949Codec.encode(input,error=>{
    expect(error.object).toBe(input);
    expect(error.encoding).toBe("cp949");
    seen.push([error.start,error.end]);
    return {replacement:string("갂"),position:BigInt(error.end)};
  },meter());
  expect([...bytes]).toEqual([0x81,0x41,0x81,0x41,65]);
  expect(seen).toEqual([[0,1],[1,2]]);
  const replacement=string("😀");
  expect(()=>cp949Codec.encode(input,()=>({replacement,position:1n<<70n}),meter()))
    .toThrow(expect.objectContaining({object:replacement,encoding:"cp949",start:0,end:1,reason:"illegal multibyte sequence"}));
});

it("accepts negative resume positions without replacing active decoding input",()=>{
  const input=Uint8Array.of(255,65);
  const result=cp949Codec.decode(input,error=>{
    error.object.fill(66);
    return {replacement:string("?"),position:-1n};
  },meter());
  expect([...result.text]).toEqual([63,65]);
  expect([...input]).toEqual([255,65]);
  expect([...cp949Codec.encode(string("😀A"),()=>({replacement:Uint8Array.of(255),position:-1n}),meter())]).toEqual([255,65]);
});

it.each([[-4n,"-1"],[4n,"4"],[-(1n<<70n),"-1"],[1n<<70n,"-1"]])("rejects invalid resume position %s",(position,display)=>{
  const expected={name:"IndexError",message:`position ${display} from error handler out of bounds`};
  expect(()=>cp949Codec.decode(Uint8Array.of(255,65,66),()=>({replacement:string("?"),position}),meter())).toThrow(expect.objectContaining(expected));
  expect(()=>cp949Codec.encode(string("😀AB"),()=>({replacement:string("?"),position}),meter())).toThrow(expect.objectContaining(expected));
});

it("restores injected encoder pending input after guest failure and clears it on success or reset",()=>{
  const budget=meter(),failure=new Error("guest failure"),encoder=new DoubleByteIncrementalEncoder(cp949Codec,()=>{throw failure;});
  const state=(0x123456789abcdef0n<<16n)|(65n<<8n)|1n;
  encoder.setstate(state,budget);
  expect(()=>encoder.encode(string("😀"),true,budget)).toThrow(failure);
  expect(encoder.getstate(budget)).toBe(state);
  encoder.errors="replace";
  expect([...encoder.encode(string("😀갂"),false,budget)]).toEqual([65,63,0x81,0x41]);
  expect(encoder.getstate(budget)).toBe(0x123456789abcdef000n);
  encoder.setstate(state,budget);
  encoder.reset(budget);
  expect(encoder.getstate(budget)).toBe(0x123456789abcdef000n);
});

it.each([false,true])("cancellation wins over recovery return and guest failure (%s)",throws=>{
  for(const operation of ["encode","decode"]){
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
    const recover=()=>{
      controller.abort();
      if(throws)throw new Error("guest failure after cancellation");
      return {replacement:string("?"),position:1n};
    };
    expect(()=>operation==="encode"?cp949Codec.encode(string("😀"),recover,budget):cp949Codec.decode(Uint8Array.of(255),recover,budget))
      .toThrow(expect.objectContaining({reason:"cancelled"}));
    expect(()=>cp949Codec.decode(new Uint8Array(),"strict",budget)).toThrow(ExecutionLimitError);
  }
});
