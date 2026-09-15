import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonDecodeError} from "./decode-error.js";
import {hkscsCodec} from "./hkscs-codec.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";

const meter=()=>new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
function attempt(operation:()=>Uint8Array|CodePointString):unknown {
  try{return ["ok",[...operation()]];}
  catch(error){
    if(!(error instanceof PythonEncodeError)&&!(error instanceof PythonDecodeError))throw error;
    return ["error",[...error.object],error.start,error.end,error.reason];
  }
}

it.each([["strict", "5b030f1b6506cf6d955e11f77959688be7636f30ea86b98fa66e439773fd9e9d"], ["ignore", "fc77f8f1bc2502e93b74d345d6a9e9c20defa1c842dc0d4a07193eecbebca89d"], ["replace", "4b525b5e79916690cbc97291cd4ed61f844fa502f62fcaa7e7c0a05d9ff39635"]] as const)("matches native HKSCS encoder prefixes, failures and state under %s",(policy,digest)=>{
  const hash=createHash("sha256"),alphabet=[65,0xca,0xea,0x304,0x30c,0xd800,0x20000,0x4e2d];let count=0;
  for(const a of alphabet)for(const b of alphabet)for(const c of alphabet)for(let split=0;split<4;split++){
    const budget=meter(),source=new CodePointString(Uint32Array.of(a,b,c),budget),encoder=new DoubleByteIncrementalEncoder(hkscsCodec,policy);
    const row:unknown[]=[attempt(()=>hkscsCodec.encode(source,policy,budget))];
    for(const [chunk,final] of [[source.slice(0n,BigInt(split),null,budget),false],[source.slice(BigInt(split),null,null,budget),false],[CodePointString.fromString("",budget),true],[CodePointString.fromString("A",budget),true]] as const){
      row.push(attempt(()=>encoder.encode(chunk,final,budget)),String(encoder.getstate(budget)));
    }
    hash.update(JSON.stringify(row)+"\n");count++;
  }
  expect(count).toBe(2048);
  expect(hash.digest("hex")).toBe(digest);
});

it.each([["strict", "033d299abaf7b948b43e00cb2598049d212d39650c0c83cb86876c55d1315545"], ["ignore", "1085f7b8ca425f982bc5835b6bca0f89636b0145bc59f989dbad998b068b3d20"], ["replace", "11176656e99f6878cdd36167cb879b75f2eb73982367231071ab5cafcd988042"]] as const)("matches all 32,768 native HKSCS pairs and split states under %s",(policy,digest)=>{
  const hash=createHash("sha256");let count=0;
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    const budget=meter(),source=Uint8Array.of(first,second),decoder=new DoubleByteIncrementalDecoder(hkscsCodec,policy);
    const row:unknown[]=[attempt(()=>hkscsCodec.decode(source,policy,budget).text)];
    for(const [chunk,final] of [[source.subarray(0,1),false],[source.subarray(1),false],[new Uint8Array(),true],[Uint8Array.of(65),true]] as const){
      row.push(attempt(()=>decoder.decode(chunk,final,budget)));
      const [pending,state]=decoder.getstate(budget);row.push([[...pending],Number(state)]);
    }
    hash.update(JSON.stringify(row)+"\n");count++;
  }
  expect(count).toBe(32768);
  expect(hash.digest("hex")).toBe(digest);
});
