import {expect,it} from "vitest";
import oracle from "./__snapshots__/jisx0213-2000-error-spans.json";
import {eucJisX0213Codec} from "./euc-jis-2004-codec.js";
import {shiftJisX0213Codec} from "./shift-jis-2004-codec.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";

it.each(oracle.rows)("preserves $name error spans across split $split final=$final resume=$position",row=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:32000});
  const seen:unknown[]=[],calls:unknown[]=[];
  const codec=row.name==="euc_jisx0213"?eucJisX0213Codec:shiftJisX0213Codec;
  const decoder=new DoubleByteIncrementalDecoder(codec,error=>{
    seen.push([error.encoding,[...error.object],error.start,error.end,error.reason]);
    return {replacement:CodePointString.fromString("?",meter),position:BigInt(seen.length===1?row.position:error.end)};
  });
  const data=Uint8Array.from([...row.raw,...row.raw,65]);
  for(const [input,final] of [[data.subarray(0,row.split),false],[data.subarray(row.split),row.final],[new Uint8Array(),true]] as const){
    let result:unknown;
    try{result=["ok",[...decoder.decode(input,final,meter)]];}
    catch(error){
      if(error instanceof PythonDecodeError)result=["error","UnicodeDecodeError",error.encoding,[...error.object],error.start,error.end,error.reason];
      else if(error instanceof PythonRuntimeError)result=["error",error.name,error.message];
      else throw error;
    }
    const [pending,state]=decoder.getstate(meter);
    calls.push([result,[[...pending],String(state)]]);
  }
  expect(seen).toEqual(row.seen);
  expect(calls).toEqual(row.calls);
});
