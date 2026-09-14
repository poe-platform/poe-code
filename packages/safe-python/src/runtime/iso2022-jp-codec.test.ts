import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import baseEvidence from "./__snapshots__/iso2022-jp-continuation-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {iso2022JpCodec as baseCodec} from "./iso2022-jp-codec.js";
import variantEvidence from "./__snapshots__/iso2022-jp-1-continuation-oracle.json";
import {iso2022Jp1Codec} from "./iso2022-jp-1-codec.js";

import extEvidence from "./__snapshots__/iso2022-jp-ext-continuation-oracle.json";
import {iso2022JpExtCodec} from "./iso2022-jp-ext-codec.js";

import jp2Evidence from "./__snapshots__/iso2022-jp-2-continuation-oracle.json";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";

describe.each([
  {codec:iso2022Jp2Codec,evidence:jp2Evidence},
  {codec:iso2022JpExtCodec,evidence:extEvidence},
  {codec:baseCodec,evidence:baseEvidence},
  {codec:iso2022Jp1Codec,evidence:variantEvidence}
])("$codec.name",({codec:iso2022JpCodec,evidence})=>{

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
function attempt(operation:()=>Uint8Array|CodePointString):unknown {
  try{return ["ok",[...operation()]];}
  catch(error){
    if(!(error instanceof PythonEncodeError)&&!(error instanceof PythonDecodeError))throw error;
    return ["error",error instanceof PythonEncodeError?"UnicodeEncodeError":"UnicodeDecodeError",[...error.object],Number(error.start),Number(error.end),error.reason];
  }
}
function run(kind:string,chunks:readonly (readonly [readonly number[],boolean])[],policy:"strict"|"ignore"|"replace"):unknown[] {
  const budget=meter(),encoder=new DoubleByteIncrementalEncoder(iso2022JpCodec,policy),decoder=new DoubleByteIncrementalDecoder(iso2022JpCodec,policy);
  const state=()=>{const [bytes,flags]=decoder.getstate(budget);return kind==="encode"?String(encoder.getstate(budget)):[[...bytes],String(flags)];};
  const out:unknown[]=[state()];
  for(const [chunk,final] of chunks){
    out.push(attempt(()=>kind==="encode"?encoder.encode(new CodePointString(Uint32Array.from(chunk),budget),final,budget):decoder.decode(Uint8Array.from(chunk),final,budget)),state());
  }
  if(kind==="encode")encoder.reset(budget);else decoder.reset(budget);
  out.push(state());return out;
}

it.each(Array.from({length:Math.ceil(evidence.rows.length/100)},(_,index)=>index))("matches pinned incremental transitions batch %i",batch=>{
  for(const row of evidence.rows.slice(batch*100,(batch+1)*100)){
    const chunks=row.chunks as [number[],boolean][];
    expect(run(row.kind,chunks,row.policy as "strict"|"ignore"|"replace"),JSON.stringify(row)).toEqual(row.result);
  }
});
it.each(evidence.pairs)("matches every second byte for designation $prefix and lead $first",({digest,first,prefix})=>{
  const hash=createHash("sha256");
  for(let second=0;second<256;second++)hash.update(JSON.stringify(run("decode",[[[...prefix,first,second],true]],"strict"))+"\n");
  expect(hash.digest("hex")).toBe(digest);
});
it.each(evidence.allpoints.map((digest,page)=>({digest,page})))("matches every encoder code point in page $page",({digest,page})=>{
  const budget=meter(),input=new CodePointString(Uint32Array.from({length:0x1000},(_,index)=>page*0x1000+index),budget);
  expect(createHash("sha256").update(iso2022JpCodec.encode(input,"replace",budget)).digest("hex")).toBe(digest);
});

});
