import {expect,it} from "vitest";
import reference from "./__snapshots__/big5-restored-state-audit-3.14.7.json";
import {big5Codecs} from "./big5-codec.js";
import {taiwanCodecs} from "./taiwan-codec.js";
import {CodePointString} from "./code-point-string.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget} from "./execution-budget.js";

function failure(error:unknown):unknown {
  if(!(error instanceof PythonRuntimeError))throw error;
  const args=error instanceof PythonDecodeError||error instanceof PythonEncodeError
    ?[error.encoding,[...error.object],error.start,error.end,error.reason]
    :[error.message];
  return ["error",error.name,error.message,args];
}

it("pins restored state evidence to the reference platform",()=>{
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.platform).toBe("darwin");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.cases).toHaveLength(150);
});

// Exercise both existing Taiwan kernel exports. Each record includes setter
// failure, retained state, subsequent strict/replacement calls and reset.
for(const [implementation,codecs] of [["big5",big5Codecs],["taiwan",taiwanCodecs]] as const){
  it.each(reference.cases)(`${implementation} restored $name $operation state=$state pending=$pending final=$final`,row=>{
    if(row.name!=="big5"&&row.name!=="cp950")throw Error("invalid oracle codec");
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    const codec=codecs[row.name],steps:unknown[]=[];
    let result:unknown=["ok"];
    if(row.operation==="encode"){
      const encoder=new DoubleByteIncrementalEncoder(codec);
      encoder.setstate((99n<<16n)|(90n<<8n)|1n,meter);
      try{encoder.setstate(BigInt(row.state),meter);}
      catch(error){result=failure(error);}
      expect(result).toEqual(row.result);
      expect(String(encoder.getstate(meter))).toEqual(row.saved);
      for(const [errors,input,final] of [["strict","A中",false],["replace","🐍",true]] as const){
        encoder.errors=errors;
        let step:unknown;
        try{step=["ok",[...encoder.encode(CodePointString.fromString(input,meter),final,meter)]];}
        catch(error){step=failure(error);}
        steps.push([step,String(encoder.getstate(meter))]);
      }
      expect(steps).toEqual(row.steps);
      encoder.reset(meter);
      expect(String(encoder.getstate(meter))).toEqual(row.reset);
    }else{
      if(row.pending===undefined||row.final===undefined)throw Error("invalid oracle decoder state");
      const decoder=new DoubleByteIncrementalDecoder(codec);
      const state=()=>{
        const [pending,flags]=decoder.getstate(meter);
        return [[...pending],String(flags)];
      };
      decoder.setstate([Uint8Array.of(90),99n],meter);
      try{decoder.setstate([Uint8Array.from(row.pending),BigInt(row.state)],meter);}
      catch(error){result=failure(error);}
      expect(result).toEqual(row.result);
      expect(state()).toEqual(row.saved);
      for(const [errors,input,final] of [["strict",[0xa4,65],row.final],["replace",[255],true]] as const){
        decoder.errors=errors;
        let step:unknown;
        try{step=["ok",[...decoder.decode(Uint8Array.from(input),final,meter)]];}
        catch(error){step=failure(error);}
        steps.push([step,state()]);
      }
      expect(steps).toEqual(row.steps);
      decoder.reset(meter);
      expect(state()).toEqual(row.reset);
    }
  });
}
