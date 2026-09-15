import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import reference from "./__snapshots__/big5-cp950-kernels-3.14.7.json";
import {big5Codecs} from "./big5-codec.js";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";

const budget=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const text=(value:string)=>CodePointString.fromString(value,budget());

for(const name of ["big5","cp950"] as const){
  it(`${name} preserves both independent mapping directions for every input`,()=>{
    const codec=big5Codecs[name],oracle=reference.families[name];
    const decoded=Buffer.alloc(32768*4),encoded=Buffer.alloc(0x110000*4);
    const meter=new ExecutionBudget({maxSteps:4000000,maxAllocatedBytes:1000000});
    let decCount=0,encCount=0;
    for(let first=128;first<256;first++)for(let second=0;second<256;second++){
      const point=codec.lookupPair(first,second,meter);
      if(point!==undefined)decCount++;
      if(point!==undefined&&typeof point!=="number")throw Error("Big5 maps one code point per pair");
      decoded.writeInt32LE(point??-1,((first-128)*256+second)*4);
    }
    for(let point=0;point<0x110000;point++){
      const bytes=codec.lookupCharacter(point,meter);
      if(bytes!==undefined)encCount++;
      encoded.writeInt32LE(bytes??-1,point*4);
    }
    expect({mapped:decCount,sha256:createHash("sha256").update(decoded).digest("hex")}).toEqual(oracle.decode);
    expect({mapped:encCount,sha256:createHash("sha256").update(encoded).digest("hex")}).toEqual(oracle.encode);
  });

  it(`${name} matches pinned split input, malformed tails and state after errors`,()=>{
    for(const row of reference.families[name].cases){
      if(row.errors!=="strict"&&row.errors!=="ignore"&&row.errors!=="replace")throw Error("invalid oracle policy");
      const meter=budget(),decoder=new DoubleByteIncrementalDecoder(big5Codecs[name],row.errors);
      const input=Uint8Array.from(row.input),steps=[];
      for(const [chunk,final] of [[input.subarray(0,row.split),false],[input.subarray(row.split),true]] as const){
        let result:unknown;
        try{result=["ok",[...decoder.decode(chunk,final,meter)]];}
        catch(error){
          if(!(error instanceof PythonDecodeError))throw error;
          result=["error",error.encoding,[...error.object],error.start,error.end,error.reason];
        }
        const [pending,flags]=decoder.getstate(meter);
        steps.push([result,[[...pending],String(flags)]]);
      }
      expect(steps,JSON.stringify(row)).toEqual(row.steps);
    }
  });

  it(`${name} preserves negative resume, replacement validation and original input`,()=>{
    const codec=big5Codecs[name],source=text("🐍A"),input=Uint8Array.of(255,65);
    expect([...codec.encode(source,error=>{
      expect(error.object).toBe(source);
      return {replacement:text("中"),position:-1n};
    },budget())]).toEqual([0xa4,0xa4,65]);
    expect([...codec.decode(input,error=>{
      error.object.fill(66);
      return {replacement:text("?"),position:-1n};
    },budget()).text]).toEqual([63,65]);
    expect([...input]).toEqual([255,65]);
    const replacement=text("\ud800");
    expect(()=>codec.encode(source,()=>({replacement,position:1n<<70n}),budget()))
      .toThrow(expect.objectContaining({object:replacement,encoding:name,start:0,end:1}));
    for(const position of [-4n,4n,1n<<70n]){
      expect(()=>codec.decode(input,()=>({replacement:text("?"),position}),budget())).toThrow(expect.objectContaining({name:"IndexError"}));
    }
  });

  it(`${name} retains incremental encoder state after guest failures`,()=>{
    const meter=budget(),failure=new Error("guest failure");
    const encoder=new DoubleByteIncrementalEncoder(big5Codecs[name],()=>{throw failure;});
    const state=(0x123456789abcdef0n<<16n)|(65n<<8n)|1n;
    encoder.setstate(state,meter);
    expect(()=>encoder.encode(text("🐍"),true,meter)).toThrow(failure);
    expect(encoder.getstate(meter)).toBe(state);
    encoder.errors="replace";
    expect([...encoder.encode(text("🐍中"),true,meter)]).toEqual([65,63,0xa4,0xa4]);
    expect(encoder.getstate(meter)).toBe(0x123456789abcdef000n);
    encoder.reset(meter);
    expect(encoder.getstate(meter)).toBe(0x123456789abcdef000n);
  });

  it(`${name} makes callback cancellation terminal on return or guest failure`,()=>{
    for(const operation of ["encode","decode"])for(const throws of [false,true]){
      const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
      const recover=()=>{
        controller.abort();
        if(throws)throw new Error("guest failure");
        return {replacement:text("?"),position:1n};
      };
      expect(()=>operation==="encode"?big5Codecs[name].encode(text("🐍"),recover,meter):big5Codecs[name].decode(Uint8Array.of(255),recover,meter))
        .toThrow(expect.objectContaining({reason:"cancelled"}));
      expect(()=>big5Codecs[name].decode(new Uint8Array(),"strict",meter)).toThrow(ExecutionLimitError);
    }
  });
}
