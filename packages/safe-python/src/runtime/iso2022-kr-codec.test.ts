import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import evidence from "./__snapshots__/iso2022-kr-kernel-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
function attempt(operation:()=>Uint8Array|CodePointString):unknown {
  try{return ["ok",[...operation()]];}
  catch(error){
    if(!(error instanceof PythonEncodeError)&&!(error instanceof PythonDecodeError))throw error;
    return ["error",error instanceof PythonEncodeError?"UnicodeEncodeError":"UnicodeDecodeError",[...error.object],Number(error.start),Number(error.end),error.reason];
  }
}
function run(kind:string,chunks:readonly (readonly [readonly number[],boolean])[],policy:"strict"|"ignore"|"replace"):unknown[] {
  const budget=meter(),encoder=new DoubleByteIncrementalEncoder(iso2022KrCodec,policy),decoder=new DoubleByteIncrementalDecoder(iso2022KrCodec,policy);
  const state=()=>{const [bytes,flags]=decoder.getstate(budget);return kind==="encode"?String(encoder.getstate(budget)):[[...bytes],String(flags)];};
  const out:unknown[]=[state()];
  for(const [chunk,final] of chunks){
    out.push(attempt(()=>kind==="encode"?encoder.encode(new CodePointString(Uint32Array.from(chunk),budget),final,budget):decoder.decode(Uint8Array.from(chunk),final,budget)),state());
  }
  if(kind==="encode")encoder.reset(budget);else decoder.reset(budget);
  out.push(state());return out;
}

it.each(Array.from({length:49},(_,index)=>index))("matches pinned incremental transitions batch %i",batch=>{
  for(const row of evidence.rows.slice(batch*100,(batch+1)*100)){
    const chunks=row.chunks as [number[],boolean][];
    expect(run(row.kind,chunks,row.policy as "strict"|"ignore"|"replace"),JSON.stringify(row)).toEqual(row.result);
  }
});
it.each(evidence.pairs.map((digest,first)=>({digest,first})))("matches all second bytes after KS X 1001 lead $first",({digest,first})=>{
  const hash=createHash("sha256");
  for(let second=0;second<256;second++)hash.update(JSON.stringify(run("decode",[[[27,36,41,67,14,first,second],true]],"strict"))+"\n");
  expect(hash.digest("hex")).toBe(digest);
});
it.each(evidence.allpoints.map((digest,page)=>({digest,page})))("matches every encoder code point in page $page",({digest,page})=>{
  const budget=meter(),input=new CodePointString(Uint32Array.from({length:0x1000},(_,index)=>page*0x1000+index),budget);
  expect(createHash("sha256").update(iso2022KrCodec.encode(input,"replace",budget)).digest("hex")).toBe(digest);
});
