import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {gb2312Codec} from "./gb2312-codec.js";
import {gbkCodec} from "./gbk-codec.js";
import {eucJpCodec} from "./euc-jp-codec.js";
import {eucJis2004Codec,eucJisX0213Codec} from "./euc-jis-2004-codec.js";
import {shiftJisCodec} from "./shift-jis-codec.js";
import {shiftJis2004Codec,shiftJisX0213Codec} from "./shift-jis-2004-codec.js";
import {cp932Codec} from "./cp932-codec.js";
import {cp949Codec} from "./cp949-codec.js";
import {johabCodec} from "./johab-codec.js";
import {eucKrCodec} from "./euc-kr-codec.js";
import {gb18030Codec} from "./gb18030-codec.js";
import {taiwanCodecs} from "./taiwan-codec.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {encodeUtf8} from "./utf8-encode.js";
import type {MultibyteEncodeRecovery} from "./double-byte-codec.js";

describe.each(([
  [eucJisX0213Codec,"4fe72497608b5fad022ce4543e9f94f8780877354b857b37499bd96399b1b3da"],
  [eucJis2004Codec,"c5006ee342dfddb6be6b6ea31d8ba016f417a15c861a1fb118e2adde7bc680ae"],
  [gb2312Codec,"59a2c5cd930c309c021755fe300e95882c374175f21cab29cec048e9382e34fa"],
  [gbkCodec,"c712023ab403f1b20bc746b64a7bbd6a3de491983b6f60cb7690f541295dbe88"],
  [johabCodec,"b7679bff8550fca79986e972a1d3dbb032cf20aaef4b83ce0259870111a952bf"],
  [eucKrCodec,"c8d1b199e8f025b5ae69f42dc5fc1eb9bb5a7fc3e89bfe700720efd9f1cbfe72"],
  [eucJpCodec,"057d62e11d2af79b091e2bafe24746268df89acb244f4511015b9c4f28d8627b"],
  [shiftJisCodec,"3dc8358b426a0b587b0f10c11b0f7a57140e94a2f7094cddb2e0c80ca768a2de"],
  [shiftJis2004Codec,"69931f9c8a095dc4ac4b077a5b0b3464d82086f52cb5ad8e2c25d0f0b42d03cc"],
  [shiftJisX0213Codec,"b59471cb5466a8c3174100fb43cc3bf639833dfaae41162e0d67e7a1fe626832"],
  [cp932Codec,"c05a55a6c1a81dc82d29c7cb52adf01e69499381be325674c1ab2521a8737dd3"],
  [cp949Codec,"d3fac40afe5f1335da03df065597c3e0a252903db927c5c97796af8bca37ef2c"],
  [gb18030Codec,"88bba0cd3f54e91ed179a238d53e744d6300fcc894b1e9ca8a4fa88cec3a4269"],
  [taiwanCodecs.big5,"e14b488399fa7a957e8b86a83b0a98994ef8e0e7f13b33c7d5d942d1968a7341"],
  [taiwanCodecs.cp950,"d2e3e81dcd965551ac5ca1fc1a9779110935b16feba0b0febe755fb2b52c3479"]
] as const).map(([codec,digest])=>({codec,digest})))("$codec.name encoder reentrancy",({codec,digest})=>{
  it("matches the pinned oracle's pending/replacement/nested failure matrix",()=>{
    const hash=createHash("sha256");let count=0;
    // Independent CPython 3.14.7 / Unicode 16.0.0 records, compact JSON + LF.
    // The oracle retains encoder.errors across the call, including mutations.
    for(const original of ["","A","😀"])
      for(const pending of ["","Z","12345678"])
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
                  encoder.setstate(state("X",123n),meter);
                  if(action==="nested-failure")encoder.errors="strict";
                  let result:unknown;
                  try{result=["ok",[...encoder.encode(text(action==="nested"?"Y":"\ud800"),false,meter)]];}
                  catch(error){result=describeFailure(error);}
                  encoder.errors=handler;
                  seen.push(["nested",result,String(encoder.getstate(meter))]);
                }
                let position=BigInt(error.end);
                if(action==="negative"&&error.end<error.object.length)position-=BigInt(error.object.length);
                if(action==="rewind"&&calls===1)position=0n;
                if(action==="out-of-bounds")position=BigInt(error.object.length+1);
                if(action==="overflow")position=1n<<63n;
                return {replacement:replacement==="bytes"?Uint8Array.of(128,255):text(replacement==="text"?"中":"\ud800"),position};
              };
              encoder.errors=handler;
              encoder.setstate(state(original,42n),meter);
              let result:unknown;
              try{result=["ok",[...encoder.encode(text("\ud800A\udfff"),final,meter)]];}
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
