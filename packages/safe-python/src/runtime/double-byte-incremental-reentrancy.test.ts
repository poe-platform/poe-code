import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
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
import {taiwanCodecs} from "./taiwan-codec.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";

describe.each([
  [eucJisX0213Codec,"d6c33726e7407ab16ff4cacd843febbe02dfc08cb7dcc0804b5e6803603e7124"],
  [eucJis2004Codec,"374a6fe2e74734ebf88593743a15868dda916f0cff4d18a25a5f1d7bb42c8401"],
  [gb2312Codec,"22e03916e6fbec8bee42627fc15741e921b95a1c0f1ce92578feeae462541c62"],
  [gbkCodec,"eb362bf19cc18d0d0022f6e8b1163217a1318604defe316b4f4000ce495d752c"],
  [johabCodec,"5b7d86b3f5490332a11ad47da614cee62f981d633ffe18e90298b68b80acea5d"],
  [eucKrCodec,"93cabdfe1d07eb35aa725e618364cf1770f786535bc72368664e09c2861ac2af"],
  [eucJpCodec,"5abf276cd3d2f1cb6bd09362814ce203d4e98e3f9c0a3425c16d22315cf364e7"],
  [shiftJisCodec,"9bb85044224d21406541ae93489b8f76678fbe5c3d0445aefd50bab73bdee85c",0x81],
  [shiftJis2004Codec,"f0981a2cceb3109795f26064a0438b2deb0f60b4525f5ffd17857c3c2ee21e44",0x81],
  [shiftJisX0213Codec,"25756bfb478a779ba1326d4dfe01b809f8d7cf7d1931d6ac9af046ec1d68e5df",0x81],
  [cp932Codec,"a80e5ecba369b0b99de3ed0ce9cf3cb155fd9dae16005dfa0ab33071f7e14712",0x81],
  [cp949Codec,"46a7134fa4edf3af73aee584c83384db5cf4b488811742f31a84f4d35689fa3b"],
  [taiwanCodecs.big5,"b1520d1005dc57b65dfcebaf2f3bce3f957e1a63f9fc6bf9652310eb4f211f30"],
  [taiwanCodecs.cp950,"a8ae84ab466f7c9c190a427ed15cc85df7b318a5f6359420f28b5eafc3f0dd67"]
] as const)("$0.name incremental reentrancy",(codec,digest,pendingLead=0xa1)=>{
  it("matches the pinned oracle's callback/state/feed/flush matrix",()=>{
    const hash=createHash("sha256");let count=0;
    // CPython 3.14.7 / Unicode 16.0.0: compact JSON records plus LF.
    // Retain exact errors, callback ordering and post-failure state, including
    // overflow after callbacks install a full eight-byte pending buffer.
    for(const original of [[],[pendingLead],[65,66,67,pendingLead]])
      for(const pending of [[],[90],[49,50,51,52,53,54,55,56]])
        for(const final of [false,true])
          for(const action of ["end","negative","rewind","out-of-bounds","raise","reset","nested"]){
            const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
            const seen:unknown[]=[],failure=new Error("guest failure");
            const decoder=new DoubleByteIncrementalDecoder(codec,error=>{
              seen.push([error.encoding,[...error.object],error.start,error.end,error.reason]);
              decoder.setstate([Uint8Array.from(pending),99n],meter);
              if(action==="raise")throw failure;
              if(action==="reset")decoder.reset(meter);
              if(action==="nested"){
                decoder.setstate([Uint8Array.of(88),123n],meter);
                seen.push(["nested",String.fromCodePoint(...decoder.decode(Uint8Array.of(89),false,meter))]);
              }
              let position=action==="negative"?-1:action==="rewind"?0:action==="out-of-bounds"?error.object.length+1:error.end;
              if(error.reason!=="incomplete multibyte sequence"&&(action==="negative"||action==="rewind"))position=error.end;
              return {replacement:CodePointString.fromString("?",meter),position:BigInt(position)};
            });
            decoder.setstate([Uint8Array.from(original),42n],meter);
            let result:unknown;
            try{result=["ok",[...decoder.decode(Uint8Array.of(255,pendingLead),final,meter)]];}
            catch(error){
              if(error instanceof PythonDecodeError)result=["error",error.name,error.encoding,[...error.object],error.start,error.end,error.reason];
              else if(error===failure)result=["error","ValueError",failure.message,true];
              else if(error instanceof PythonRuntimeError)result=["error",error.name,error.message,false];
              else throw error;
            }
            const [bytes,state]=decoder.getstate(meter);
            hash.update(JSON.stringify([original,pending,final,action,seen,result,[[...bytes],String(state)]])+"\n");
            count++;
          }
    expect(count).toBe(126);
    expect(hash.digest("hex")).toBe(digest);
  });

  it.each([false,true])("cancellation wins after a state-mutating callback (throws=%s)",throws=>{
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
    const decoder=new DoubleByteIncrementalDecoder(codec,()=>{
      decoder.setstate([Uint8Array.of(90),99n],meter);
      controller.abort();
      if(throws)throw new Error("service failure");
      return {replacement:CodePointString.fromString("?"),position:-1n};
    });
    decoder.setstate([Uint8Array.of(pendingLead),42n],meter);
    expect(()=>decoder.decode(new Uint8Array(),true,meter)).toThrow(ExecutionLimitError);
    for(const operation of [()=>decoder.getstate(meter),()=>decoder.reset(meter),()=>decoder.decode(Uint8Array.of(65),true,meter)])expect(operation).toThrow(ExecutionLimitError);
  });
});
