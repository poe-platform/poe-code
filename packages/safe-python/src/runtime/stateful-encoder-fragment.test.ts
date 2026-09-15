import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import reference from "./__snapshots__/stateful-encoder-fragment-oracle.json";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022Jp1Codec} from "./iso2022-jp-1-codec.js";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";
import {iso2022Jp3Codec,iso2022Jp2004Codec} from "./iso2022-jis-revision-codec.js";
import {iso2022JpExtCodec} from "./iso2022-jp-ext-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";
import {hzCodec} from "./hz-codec.js";

const codecs=[iso2022JpCodec,iso2022Jp1Codec,iso2022Jp2Codec,iso2022Jp3Codec,iso2022Jp2004Codec,iso2022JpExtCodec,iso2022KrCodec,hzCodec];

it.each(reference.cases)("preserves fragmented $name encoder results, failures and restored state",row=>{
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.byteorder).toBe("little");
  const codec=codecs.find(candidate=>candidate.name===row.name)!;
  const digest=createHash("sha256");
  let state=reference.seed;
  const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state>>>8;};
  for(let index=0;index<row.count;index++){
    const data=Array.from({length:1+next()%19},()=>reference.alphabet[next()%reference.alphabet.length]);
    const policy=(["strict","ignore","replace"] as const)[next()%3],split=next()%(data.length+1);
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    let encoder=new DoubleByteIncrementalEncoder(codec,policy);
    const steps:unknown[]=[];
    for(const [part,final] of [[data.slice(0,split),false],[data.slice(split),false],[[],true],[[0x304b],false],[[0x309a,65],true]] as const){
      let result:unknown;
      try{result=["ok",[...encoder.encode(new CodePointString(Uint32Array.from(part),meter),final,meter)]];}
      catch(error){
        if(error instanceof PythonEncodeError)result=["error",error.name,error.encoding,[...error.object],error.start,error.end,error.reason];
        else if(error instanceof PythonRuntimeError)result=["error",error.name,error.message];
        else throw error;
      }
      const saved=encoder.getstate(meter);
      steps.push([result,String(saved)]);
      const restored=new DoubleByteIncrementalEncoder(codec,policy);
      restored.setstate(saved,meter);
      encoder=restored;
    }
    encoder.reset(meter);
    const saved=encoder.getstate(meter);
    steps.push(String(saved));
    digest.update(JSON.stringify([data,policy,split,steps])+"\n");
  }
  expect(digest.digest("hex")).toBe(row.digest);
});
