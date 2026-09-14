import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {hzCodec} from "./hz-codec.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";

it("matches 7,776 native HZ shift split/recovery/state/later-call records",()=>{
  const hash=createHash("sha256");let count=0;
  // Independent CPython 3.14.7 oracle source and digest are retained in
  // __snapshots__/hz-kernel-oracle.json. Records preserve
  // failures and the following calls instead of discarding failed streams.
  for(const data of [[],[126],[126,123],[126,125],[126,126],[126,10],[126,123,86,80,126,125],[126,123,255,86],[65,126,123,86,80,126,125,90]])
    for(let split=0;split<=data.length;split++)
      for(const original of [[],[126],[126,123],[126,123,86]])
        for(const pending of [[],[90],[49,50,51,52,53,54,55,56]])
          for(const action of ["end","negative","rewind","bounds","overflow","raise","reset","nested","policy"])
            for(const replacement of ["?","\ud800"]){
              const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
              const seen:unknown[]=[],failure=new Error("guest failure");let rewound=false;
              const decoder=new DoubleByteIncrementalDecoder(hzCodec,error=>{
                seen.push([error.encoding,[...error.object],error.start,error.end,error.reason]);
                decoder.setstate([Uint8Array.from(pending),99n],meter);
                if(action==="raise")throw failure;
                if(action==="reset")decoder.reset(meter);
                if(action==="nested"){
                  decoder.setstate([Uint8Array.of(86),123n],meter);
                  seen.push(["nested",[...decoder.decode(Uint8Array.of(80),false,meter)]]);
                }
                if(action==="policy")decoder.errors="replace";
                let position=BigInt(error.end);
                if(action==="negative"&&!rewound){rewound=true;position=-1n;}
                if(action==="rewind"&&!rewound){rewound=true;position=0n;}
                if(action==="bounds")position=BigInt(error.object.length+1);
                if(action==="overflow")position=1n<<70n;
                return {replacement:CodePointString.fromString(replacement,meter),position};
              });
              decoder.setstate([Uint8Array.from(original),0n],meter);
              const results:unknown[]=[];
              for(const [chunk,final] of [[data.slice(0,split),false],[data.slice(split),false],[[],true],[[65],true]] as const){
                let result:unknown;
                try{result=["ok",[...decoder.decode(Uint8Array.from(chunk),final,meter)]];}
                catch(error){
                  if(error instanceof PythonDecodeError)result=["error",error.name,error.encoding,[...error.object],error.start,error.end,error.reason];
                  else if(error===failure)result=["error","ValueError",failure.message,true];
                  else if(error instanceof PythonRuntimeError)result=["error",error.name,error.message,false];
                  else throw error;
                }
                const [bytes,state]=decoder.getstate(meter);
                results.push([result,[[...bytes],String(state)]]);
              }
              hash.update(JSON.stringify([data,split,original,pending,action,[replacement.charCodeAt(0)],seen,results])+"\n");
              count++;
            }
  expect(count).toBe(7776);
  expect(hash.digest("hex")).toBe("2257b7d9b4eefcf4327e79c17fba570f66eafa969c9a3e5aab7d5b807dde0d6c");
});

it.each([false,true])("keeps nested HZ shift recovery cancellation terminal (throws=%s)",throws=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const replacement=CodePointString.fromString("?",meter);let calls=0;
  const decoder=new DoubleByteIncrementalDecoder(hzCodec,()=>{
    calls++;
    if(calls===1){
      decoder.setstate([Uint8Array.of(129,48,129),99n],meter);
      decoder.decode(Uint8Array.of(0),false,meter);
      throw Error("resumed after nested cancellation");
    }
    controller.abort();
    if(throws)throw Error("service failure");
    return {replacement,position:-1n};
  });
  decoder.setstate([Uint8Array.of(255,48,255),42n],meter);
  expect(()=>decoder.decode(Uint8Array.of(48),true,meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(2);
  for(const operation of [()=>decoder.getstate(meter),()=>decoder.reset(meter),()=>decoder.setstate([new Uint8Array(),0n],meter),()=>decoder.decode(Uint8Array.of(65),true,meter)])expect(operation).toThrow(ExecutionLimitError);
});
