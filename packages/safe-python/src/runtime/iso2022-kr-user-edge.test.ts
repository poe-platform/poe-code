import {expect,it} from "vitest";
import evidence from "./__snapshots__/iso2022-kr-user-edge-oracle.json";
import {PythonDecodeError} from "./decode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget} from "./execution-budget.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";

it.each(Array.from({length:Math.ceil(evidence.rows.length/50)},(_,index)=>index))(
  "matches stateful user decoding and reset sequences batch %i",batch=>{
    for(const row of evidence.rows.slice(batch*50,(batch+1)*50)){
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      let decoder=new DoubleByteIncrementalDecoder(iso2022KrCodec,row.policy as "strict"|"ignore"|"replace");
      const state=()=>{const [pending,flags]=decoder.getstate(meter);return [[...pending],String(flags)];};
      for(const step of row.steps){
        let result:unknown;
        try{result=["ok",[...decoder.decode(Uint8Array.from(step.data),step.final,meter)]];}
        catch(error){
          if(!(error instanceof PythonDecodeError))throw error;
          result=["error",error.name,error.message,error.encoding,[...error.object],Number(error.start),Number(error.end),error.reason];
        }
        expect(result,JSON.stringify(step)).toEqual(step.result);
        expect(state()).toEqual(step.after);
        if(step.reset)decoder.reset(meter);
        expect(state()).toEqual(step.state);
        const restored=new DoubleByteIncrementalDecoder(iso2022KrCodec,decoder.errors);
        restored.setstate(decoder.getstate(meter),meter);
        decoder=restored;
      }
    }
  }
);
