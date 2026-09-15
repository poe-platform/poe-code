import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import reference from "./__snapshots__/iso2022-mixed-decoder-3.14.7.json";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";

const codecs=[iso2022JpCodec,iso2022Jp2Codec,iso2022KrCodec];
let seed=reference.seed;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
const cases=codecs.flatMap(codec=>Array.from({length:3000},()=>{
  const input:number[]=[];
  for(let part=0;part<3;part++){
    input.push(...reference.fragments[random()%reference.fragments.length]);
    // Preserve the oracle corpus's random draw on each loop condition.
    for(let index=0;index<random()%5;index++)input.push(random()%256);
  }
  return {name:codec.name,input};
}));

it("retains the complete mixed-decoder corpus and reference pin",()=>{
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  expect(cases).toHaveLength(reference.count);
  expect(reference.count).toBe(9000);
  expect(reference.blocks.map(({offset,count})=>[offset,count])).toEqual(
    Array.from({length:90},(_,index)=>[index*100,100])
  );
  expect(createHash("sha256").update(JSON.stringify(cases)).digest("hex")).toBe(reference.inputSha256);
});

it.each(reference.blocks)("matches mixed escape/replacement rows $offset + $count",({offset,count,sha256})=>{
  const outcomes=cases.slice(offset,offset+count).map(({name,input})=>{
    const codec=codecs.find(candidate=>candidate.name===name)!;
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    try{return ["ok",[...codec.decode(Uint8Array.from(input),"replace",meter).text]];}
    catch(error){
      if(!(error instanceof PythonRuntimeError))throw error;
      return ["error",error.name,error.message];
    }
  });
  expect(createHash("sha256").update(JSON.stringify(outcomes)).digest("hex")).toBe(sha256);
});
