import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {decodeWideUnicode,type UnicodeByteOrder} from "./utf-wide.js";
import reference from "./__snapshots__/codec-wide-recovery-audit.json";

// Replay every retained oracle row in bounded groups. The callback boundary
// receives a validated, nonnegative position, as supplied by the registry.
const groups=Array.from({length:Math.ceil(reference.cases.length/50)},(_,index)=>({
  index,cases:reference.cases.slice(index*50,(index+1)*50)
}));

it.each(groups)("matches pinned wide-codec replaced-input recovery group $index",({cases})=>{
  for(const {input,expected} of cases){
    const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
    const events:unknown[][]=[];
    const fault=(error:PythonDecodeError)=>[error.encoding,[...error.object],error.start,error.end,error.reason];
    let actual:unknown;
    try {
      const result=decodeWideUnicode(Uint8Array.from(input.input),input.width as 16|32,input.order as UnicodeByteOrder,error=>{
        events.push(fault(error));
        if(events.length>1)throw error;
        return {
          replacement:new CodePointString(Uint32Array.of(63),meter),
          position:input.position<0?input.position+input.replacement.length:input.position,
          input:Uint8Array.from(input.replacement)
        };
      },meter,input.final);
      actual={result:[[...result.text],result.consumed,result.byteorder],events};
    }catch(error){
      // Unexpected host faults and sandbox termination must fail the test.
      if(!(error instanceof PythonDecodeError))throw error;
      actual={error:fault(error),events};
    }
    expect(actual,JSON.stringify(input)).toEqual(expected);
  }
});
