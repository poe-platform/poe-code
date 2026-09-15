import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import oracle from "./__snapshots__/shift-jis-2004-sequences.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonEncodeError} from "./encode-error.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {shiftJis2004Codec} from "./shift-jis-2004-codec.js";

function failure(error:unknown):unknown[] {
  if(!(error instanceof PythonEncodeError))throw error;
  return ["error",error.encoding,[...error.object],error.start,error.end,error.reason];
}

it.each(oracle.pairs)("matches prefix $prefix with every BMP suffix in block $block",({prefix,block,sha256})=>{
  const hash=createHash("sha256");
  for(let suffix=block*8192;suffix<(block+1)*8192;suffix++){
    const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:16000});
    let row:unknown;
    try{row=["ok",[...shiftJis2004Codec.encode(CodePointString.fromString(String.fromCodePoint(prefix,suffix),meter),"strict",meter)]];}
    catch(error){row=failure(error);}
    hash.update(JSON.stringify(row)+"\n");
  }
  expect(hash.digest("hex")).toBe(sha256);
});

it.each(oracle.replay)("replays prefix $prefix suffix $suffix with $errors final=$final",row=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:16000});
  if(row.errors!=="strict"&&row.errors!=="ignore"&&row.errors!=="replace")throw Error("invalid oracle policy");
  const encoder=new DoubleByteIncrementalEncoder(shiftJis2004Codec,row.errors);
  encoder.setstate(0x123456789abcdef000n,meter);
  const calls=[];
  for(const [source,final] of [[String.fromCodePoint(row.prefix),false],[String.fromCodePoint(row.suffix),row.final],["",true]] as const){
    let result:unknown;
    try{result=["ok",[...encoder.encode(CodePointString.fromString(source,meter),final,meter)]];}
    catch(error){result=failure(error);}
    calls.push([result,String(encoder.getstate(meter))]);
  }
  expect(calls).toEqual(row.calls);
  encoder.reset(meter);expect(String(encoder.getstate(meter))).toBe(row.reset);
});
