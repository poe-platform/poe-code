import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import oracle from "./__snapshots__/euc-kr-kernel-oracle.json";
import encodePartitions from "./__snapshots__/euc-kr-encode-partitions-3.14.7.json";
import incrementalOracle from "./__snapshots__/euc-kr-incremental-partitions-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {eucKrCodec} from "./euc-kr-codec.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const string=(text:string)=>CodePointString.fromString(text,meter());
function failure(error:unknown):unknown[] {
  if(!(error instanceof PythonDecodeError)&&!(error instanceof PythonEncodeError))throw error;
  return ["error",error.encoding,[...error.object],error.start,error.end,error.reason];
}

it.each(["strict","ignore","replace"] as const)("matches every high-leading EUC-KR pair under %s",errors=>{
  const hash=createHash("sha256");
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    let row:unknown;
    try{const result=eucKrCodec.decode(Uint8Array.of(first,second),errors,meter());row=["ok",[...result.text],result.consumed];}
    catch(error){row=failure(error);}
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(oracle.decode[errors].sha256);
});

function splitRow(data:Uint8Array,split:number,final:boolean,errors:"strict"|"ignore"|"replace"):unknown {
  const budget=meter(),decoder=new DoubleByteIncrementalDecoder(eucKrCodec,errors);
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

it("retains the complete split-pair oracle when partitioning by leading byte",()=>{
  expect(incrementalOracle.reference).toEqual(oracle.reference);
  for(const errors of ["strict","ignore","replace"] as const){
    const reference=incrementalOracle.incremental[errors];
    expect(reference.sha256).toBe(oracle.incremental[errors].sha256);
    expect(reference.records).toBe(oracle.incremental[errors].records);
    expect(reference.partitions.map(part=>part.first)).toEqual(Array.from({length:256},(_,first)=>first));
    expect(reference.partitions.map(part=>part.records)).toEqual(new Array<number>(256).fill(512));
  }
});

it.each((["strict","ignore","replace"] as const).flatMap(errors=>
  incrementalOracle.incremental[errors].partitions.map(part=>({errors,...part}))
))("matches every split byte pair with finalization and opaque state under $errors, leading byte $first",({errors,first,records,sha256})=>{
  const hash=createHash("sha256");
  let count=0;
  for(let second=0;second<256;second++)for(const final of [false,true]){
    hash.update(JSON.stringify(splitRow(Uint8Array.of(first,second),1,final,errors))+"\n");
    count++;
  }
  expect(count).toBe(records);
  expect(hash.digest("hex")).toBe(sha256);
});

it.each(["strict","ignore","replace"] as const)("matches all Hangul composition splits under %s",errors=>{
  const hash=createHash("sha256");let count=0;
  for(let point=0xac00;point<=0xd7a3;point++){
    const bytes=eucKrCodec.encode(string(String.fromCodePoint(point)),"strict",meter());
    for(let split=0;split<=bytes.length;split++)for(const final of [false,true]){
      hash.update(JSON.stringify(splitRow(bytes,split,final,errors))+"\n");count++;
    }
  }
  expect(count).toBe(oracle.hangul[errors].records);
  expect(hash.digest("hex")).toBe(oracle.hangul[errors].sha256);
});

it.each(["strict","ignore","replace"] as const)("matches every composition byte mutation, prefix and split under %s",errors=>{
  const hash=createHash("sha256"),base=Uint8Array.of(0xa4,0xd4,0xa4,0xa1,0xa4,0xbf,0xa4,0xd4);let count=0;
  const add=(bytes:Uint8Array)=>{
    for(let split=0;split<=bytes.length;split++)for(const final of [false,true]){
      hash.update(JSON.stringify(splitRow(bytes,split,final,errors))+"\n");count++;
    }
  };
  for(let position=0;position<8;position++)for(let byte=0;byte<256;byte++){
    const bytes=base.slice();bytes[position]=byte;add(bytes);
  }
  for(let size=0;size<8;size++)add(base.subarray(0,size));
  expect(count).toBe(oracle.composition[errors].records);
  expect(hash.digest("hex")).toBe(oracle.composition[errors].sha256);
});

it("retains every strict Unicode encoding oracle across plane partitions",()=>{
  expect(encodePartitions.reference.version.split(" ")[0]).toBe(oracle.reference.version.split(" ")[0]);
  expect(encodePartitions.reference).toMatchObject({unicode:oracle.reference.unicode,platform:oracle.reference.platform,byteorder:oracle.reference.byteorder});
  expect(encodePartitions.records).toBe(oracle.strictEncode.records);
  expect(encodePartitions.sha256).toBe(oracle.strictEncode.sha256);
  expect(encodePartitions.planes.map(row=>row.plane)).toEqual(Array.from({length:17},(_,plane)=>plane));
  for(const row of encodePartitions.planes){
    expect(row.sha256).toBe(oracle.strictEncode.planes[row.plane]);
    expect(row.partitions.map(part=>part.block)).toEqual(Array.from({length:16},(_,block)=>block));
    expect(row.partitions.map(part=>part.records)).toEqual(new Array<number>(16).fill(4096));
  }
});

it.each(encodePartitions.planes.flatMap(row=>row.partitions.map(part=>({plane:row.plane,...part}))))("matches every strict Unicode encoding and fault in plane $plane block $block",({plane,block,records,sha256})=>{
  const hash=createHash("sha256");
  let count=0;
  for(let point=plane*0x10000+block*4096;point<plane*0x10000+(block+1)*4096;point++){
    let row:unknown;
    try{row=["ok",[...eucKrCodec.encode(string(String.fromCodePoint(point)),"strict",meter())]];}
    catch(error){row=failure(error);}
    hash.update(JSON.stringify(row)+"\n");count++;
  }
  expect(count).toBe(records);
  expect(hash.digest("hex")).toBe(sha256);
});

it.each(["ignore","replace"] as const)("matches all-point encoding with %s",errors=>{
  const budget=new ExecutionBudget({maxSteps:16000000,maxAllocatedBytes:64000000});
  const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
  const result=eucKrCodec.encode(input,errors,budget);
  expect(result.length).toBe(oracle.encode[errors].length);
  expect(createHash("sha256").update(result).digest("hex")).toBe(oracle.encode[errors].sha256);
});

it("encodes extension Hangul with eight-byte composition and canonical KS X 1001 syllables with two bytes",()=>{
  const bytes=eucKrCodec.encode(string("A가갂힣"),"strict",meter());
  expect([...bytes]).toEqual([65,0xb0,0xa1,0xa4,0xd4,0xa4,0xa1,0xa4,0xbf,0xa4,0xa2,0xa4,0xd4,0xa4,0xbe,0xa4,0xd3,0xa4,0xbe]);
  expect([...eucKrCodec.decode(bytes,"strict",meter()).text]).toEqual([...string("A가갂힣")]);
});

it("keeps decoding input immutable and validates negative resumes after replacement encoding",()=>{
  const bytes=Uint8Array.of(255,65),text=string("😀A");
  expect([...eucKrCodec.decode(bytes,error=>{
    error.object.fill(66);return {replacement:string("갂"),position:-1n};
  },meter()).text]).toEqual([...string("갂A")]);
  expect([...bytes]).toEqual([255,65]);
  const result=eucKrCodec.encode(text,error=>{
    expect(error.object).toBe(text);return {replacement:string("갂"),position:-1n};
  },meter());
  expect([...result]).toEqual([0xa4,0xd4,0xa4,0xa1,0xa4,0xbf,0xa4,0xa2,65]);
  const replacement=string("\ud800");
  expect(()=>eucKrCodec.encode(text,()=>({replacement,position:1n<<70n}),meter()))
    .toThrow(expect.objectContaining({object:replacement,encoding:"euc_kr",start:0,end:1,reason:"illegal multibyte sequence"}));
});

it("retains encoder pending text and flags across guest failure and resets pending input",()=>{
  const budget=meter(),failure=new Error("guest failure"),encoder=new DoubleByteIncrementalEncoder(eucKrCodec,()=>{throw failure;});
  const state=(0x123456789abcdef0n<<16n)|(65n<<8n)|1n;
  encoder.setstate(state,budget);
  expect(()=>encoder.encode(string("😀"),true,budget)).toThrow(failure);
  expect(encoder.getstate(budget)).toBe(state);
  encoder.errors="replace";
  expect([...encoder.encode(string("😀갂"),false,budget)]).toEqual([65,63,0xa4,0xd4,0xa4,0xa1,0xa4,0xbf,0xa4,0xa2]);
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
    expect(()=>operation==="encode"?eucKrCodec.encode(string("😀"),recover,budget):eucKrCodec.decode(Uint8Array.of(255),recover,budget))
      .toThrow(expect.objectContaining({reason:"cancelled"}));
    expect(()=>eucKrCodec.decode(new Uint8Array(),"strict",budget)).toThrow(ExecutionLimitError);
  }
});
