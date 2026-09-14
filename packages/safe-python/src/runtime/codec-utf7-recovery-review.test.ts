import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {decodeUtf7} from "./utf7.js";
import reference from "./__snapshots__/codec-utf7-recovery-review.json";

let state=reference.seed;
const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
const alphabet=[43,45,65,66,47,90,97,32,0,128,255];
const cases=Array.from({length:reference.count},(_,index)=>({
  final:!!(index%2),
  input:Array.from({length:random()%20},()=>alphabet[random()%alphabet.length]),
  replacement:Array.from({length:random()%20},()=>alphabet[random()%alphabet.length]),
  position:0
}));
for(const [index,input] of cases.entries()){
  input.position=random()%(input.replacement.length+1);
  if(index%2&&input.position<input.replacement.length)input.position-=input.replacement.length;
}

it("retains all UTF-7 recovery cases and the pinned oracle identity",()=>{
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  expect(cases).toHaveLength(10000);
  expect(reference.blocks.map(({offset,count})=>[offset,count])).toEqual(
    Array.from({length:200},(_,index)=>[index*50,50])
  );
  expect(createHash("sha256").update(JSON.stringify(cases)).digest("hex")).toBe(reference.inputSha256);
});

// The external oracle covers every row; bounded groups replay real kernels
// without subprocesses or filesystem writes. The registry validates negative
// positions before passing them to this kernel's recovery boundary.
it.each(reference.blocks)("matches UTF-7 recovery rows $offset + $count",({offset,count,sha256})=>{
  const outcomes=cases.slice(offset,offset+count).map(input=>{
    const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
    const events:unknown[][]=[];
    const fault=(error:PythonDecodeError)=>[error.encoding,[...error.object],error.start,error.end,error.reason];
    try {
      const result=decodeUtf7(Uint8Array.from(input.input),error=>{
        events.push(fault(error));
        if(events.length>1)throw error;
        return {
          replacement:new CodePointString(Uint32Array.of(63),meter),
          position:input.position<0?input.position+input.replacement.length:input.position,
          input:Uint8Array.from(input.replacement)
        };
      },meter,input.final);
      return {result:[[...result.text],result.consumed],events};
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      return {error:fault(error),events};
    }
  });
  expect(createHash("sha256").update(JSON.stringify(outcomes)).digest("hex")).toBe(sha256);
});
