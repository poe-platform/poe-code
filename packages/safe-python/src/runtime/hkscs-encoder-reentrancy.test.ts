import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {hkscsCodec} from "./hkscs-codec.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {encodeUtf8} from "./utf8-encode.js";
import type {MultibyteEncodeRecovery} from "./double-byte-codec.js";

describe.each([{codec:hkscsCodec,digest:"a0f9ce0418faed48fb421d54fee5e59da776a9ee8ae88b69ce4240c42f71b7e9"}])("$codec.name encoder reentrancy",({codec,digest})=>{
  it("matches the pinned oracle's pending/replacement/nested failure matrix",()=>{
    const hash=createHash("sha256");let count=0;
    // Independent CPython 3.14.7 / Unicode 16.0.0 records, compact JSON + LF.
    // The oracle retains encoder.errors across the call, including mutations.
    for(const original of ["","Ê","ê"])
      for(const pending of ["","Ê","12345678"])
        for(const final of [false,true])
          for(const action of ["end","negative","rewind","out-of-bounds","overflow","raise","reset","nested","nested-failure","policy"])
            for(const replacement of ["bytes","text","invalid"]){
              const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
              const text=(value:string)=>CodePointString.fromString(value,meter);
              const state=(value:string,opaque:bigint)=>{
                const bytes=encodeUtf8(text(value),"strict",meter);
                for(let index=bytes.length-1;index>=0;index--)opaque=(opaque<<8n)|BigInt(bytes[index]);
                return (opaque<<8n)|BigInt(bytes.length);
              };
              const seen:unknown[]=[],failure=new Error("guest failure");let calls=0;
              const describeFailure=(error:unknown)=>{
                if(error instanceof PythonEncodeError)return ["error",error.name,error.encoding,[...error.object],error.start,error.end,error.reason];
                if(error===failure)return ["error","ValueError",failure.message,true];
                if(error instanceof PythonRuntimeError)return ["error",error.name,error.message,false];
                throw error;
              };
              const encoder=new DoubleByteIncrementalEncoder(codec);
              const handler:MultibyteEncodeRecovery=error=>{
                calls++;
                seen.push([error.encoding,[...error.object],error.start,error.end,error.reason]);
                encoder.setstate(state(pending,99n),meter);
                if(action==="raise")throw failure;
                if(action==="reset")encoder.reset(meter);
                if(action==="policy")encoder.errors="ignore";
                if(action==="nested"||action==="nested-failure"){
                  encoder.setstate(state("Ê",123n),meter);
                  if(action==="nested-failure")encoder.errors="strict";
                  let result:unknown;
                  try{result=["ok",[...encoder.encode(text(action==="nested"?"\u0304":"\ud800"),false,meter)]];}
                  catch(error){result=describeFailure(error);}
                  encoder.errors=handler;
                  seen.push(["nested",result,String(encoder.getstate(meter))]);
                }
                let position=BigInt(error.end);
                if(action==="negative"&&error.end<error.object.length)position-=BigInt(error.object.length);
                if(action==="rewind"&&calls===1)position=0n;
                if(action==="out-of-bounds")position=BigInt(error.object.length+1);
                if(action==="overflow")position=1n<<63n;
                return {replacement:replacement==="bytes"?Uint8Array.of(128,255):text(replacement==="text"?"ê":"\ud800"),position};
              };
              encoder.errors=handler;
              encoder.setstate(state(original,42n),meter);
              let result:unknown;
              try{result=["ok",[...encoder.encode(text("\ud800Ê\u0304\udfffê"),final,meter)]];}
              catch(error){result=describeFailure(error);}
              hash.update(JSON.stringify([[...text(original)],[...text(pending)],final,action,replacement,seen,result,String(encoder.getstate(meter))])+"\n");
              count++;
            }
    expect(count).toBe(540);
    expect(hash.digest("hex")).toBe(digest);
  });

  it.each([false,true])("keeps nested callback cancellation terminal (throws=%s)",throws=>{
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
    const encoder=new DoubleByteIncrementalEncoder(codec);
    encoder.errors=()=>{
      encoder.setstate(0x635a01n,meter);
      encoder.errors=()=>{
        controller.abort();
        if(throws)throw new Error("service failure");
        return {replacement:Uint8Array.of(63),position:1n};
      };
      encoder.encode(CodePointString.fromString("\ud800",meter),false,meter);
      throw new Error("nested cancellation returned");
    };
    expect(()=>encoder.encode(CodePointString.fromString("\udfff",meter),true,meter)).toThrow(expect.objectContaining({reason:"cancelled"}));
    for(const run of [()=>encoder.getstate(meter),()=>encoder.setstate(0n,meter),()=>encoder.reset(meter)])expect(run).toThrow(ExecutionLimitError);
  });
});
