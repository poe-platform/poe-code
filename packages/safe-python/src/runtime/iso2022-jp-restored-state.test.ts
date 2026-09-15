import {describe,expect,it} from "vitest";
import baseEvidence from "./__snapshots__/iso2022-jp-restored-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {ExecutionBudget} from "./execution-budget.js";
import {iso2022JpCodec as baseCodec} from "./iso2022-jp-codec.js";
import variantEvidence from "./__snapshots__/iso2022-jp-1-restored-oracle.json";
import {iso2022Jp1Codec} from "./iso2022-jp-1-codec.js";

import extEvidence from "./__snapshots__/iso2022-jp-ext-restored-oracle.json";
import {iso2022JpExtCodec} from "./iso2022-jp-ext-codec.js";

import jp2Evidence from "./__snapshots__/iso2022-jp-2-restored-oracle.json";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";

describe.each([
  {codec:iso2022Jp2Codec,evidence:jp2Evidence},
  {codec:iso2022JpExtCodec,evidence:extEvidence},
  {codec:baseCodec,evidence:baseEvidence},
  {codec:iso2022Jp1Codec,evidence:variantEvidence}
])("$codec.name",({codec:iso2022JpCodec,evidence})=>{

it.each(Array.from({length:Math.ceil(evidence.rows.length/40)},(_,index)=>index))(
  "matches restored ISO-2022-JP input, flags and continuation batch %i",batch=>{
    expect(evidence.target).toMatchObject({version:"3.14.7",unicode:"16.0.0",platform:"darwin",byteorder:"little"});
    for(const row of evidence.rows.slice(batch*40,(batch+1)*40)){
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const policy=row.policy as "strict"|"ignore"|"replace";
      let encoder=new DoubleByteIncrementalEncoder(iso2022JpCodec,policy);
      let decoder=new DoubleByteIncrementalDecoder(iso2022JpCodec,policy);
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
        const restoredEncoder=new DoubleByteIncrementalEncoder(iso2022JpCodec,policy);
        restoredEncoder.setstate(encoder.getstate(meter),meter);
        encoder=restoredEncoder;
        const restoredDecoder=new DoubleByteIncrementalDecoder(iso2022JpCodec,policy);
        restoredDecoder.setstate(decoder.getstate(meter),meter);
        decoder=restoredDecoder;
      }
    }
  }
);

});
