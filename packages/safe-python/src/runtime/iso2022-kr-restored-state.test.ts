import {expect,it} from "vitest";
import evidence from "./__snapshots__/iso2022-kr-restored-state-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {ExecutionBudget} from "./execution-budget.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";

it.each(Array.from({length:Math.ceil(evidence.rows.length/40)},(_,index)=>index))(
  "matches restored ISO-2022-KR input, flags and continuation batch %i",batch=>{
    expect(evidence.target).toMatchObject({version:"3.14.7",unicode:"16.0.0",platform:"darwin",byteorder:"little"});
    for(const row of evidence.rows.slice(batch*40,(batch+1)*40)){
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const policy=row.policy as "strict"|"ignore"|"replace";
      let encoder=new DoubleByteIncrementalEncoder(iso2022KrCodec,policy);
      let decoder=new DoubleByteIncrementalDecoder(iso2022KrCodec,policy);
      if(typeof row.initial==="string")encoder.setstate(BigInt(row.initial),meter);
      else decoder.setstate([Uint8Array.from(row.initial[0] as number[]),BigInt(row.initial[1] as string)],meter);
      const state=()=>{
        if(row.kind==="encode")return String(encoder.getstate(meter));
        const [pending,flags]=decoder.getstate(meter);
        return [[...pending],String(flags)];
      };
      for(const step of row.steps){
        let result:unknown[];
        try{
          const value=row.kind==="encode"
            ?encoder.encode(new CodePointString(Uint32Array.from(step.data),meter),step.final,meter)
            :decoder.decode(Uint8Array.from(step.data),step.final,meter);
          result=["ok",[...value]];
        }catch(error){
          if(!(error instanceof PythonRuntimeError))throw error;
          result=["error",error.name,error.message];
          if(error instanceof PythonDecodeError||error instanceof PythonEncodeError){
            result.push(error.encoding,[...error.object],Number(error.start),Number(error.end),error.reason);
          }
        }
        expect(result,JSON.stringify({row,step})).toEqual(step.result);
        expect(state()).toEqual(step.after);
        if(step.reset){if(row.kind==="encode")encoder.reset(meter);else decoder.reset(meter);}
        expect(state()).toEqual(step.state);
        const restoredEncoder=new DoubleByteIncrementalEncoder(iso2022KrCodec,policy);
        restoredEncoder.setstate(encoder.getstate(meter),meter);
        encoder=restoredEncoder;
        const restoredDecoder=new DoubleByteIncrementalDecoder(iso2022KrCodec,policy);
        restoredDecoder.setstate(decoder.getstate(meter),meter);
        decoder=restoredDecoder;
      }
    }
  }
);
