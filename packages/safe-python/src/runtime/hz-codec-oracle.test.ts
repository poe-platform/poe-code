import { withoutErrorStacks } from "../../tests/helpers/without-error-stacks.js";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import evidence from "./__snapshots__/hz-kernel-oracle.json";
import decodePartitions from "./__snapshots__/hz-decode-partitions-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {hzCodec} from "./hz-codec.js";

const meter=()=>new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
function attempt(operation:()=>Uint8Array|CodePointString):unknown {
  try{return ["ok",[...operation()]];}
  catch(error){
    if(!(error instanceof PythonEncodeError)&&!(error instanceof PythonDecodeError))throw error;
    return ["error",[...error.object],error.start,error.end,error.reason];
  }
}

it("retains the complete HZ decode oracle across leading-byte partitions",()=>{
  expect(decodePartitions.reference.version.split(" ")[0]).toBe(evidence.reference.version.split(" ")[0]);
  expect(decodePartitions.reference).toMatchObject({unicode:evidence.reference.unicode,byteorder:evidence.reference.byteorder});
  expect(decodePartitions.results).toHaveLength(9);
  for(const reference of decodePartitions.results){
    const original=evidence.results.find(row=>row.kind==="decode"&&row.policy===reference.policy&&row.mode===reference.mode)!;
    expect(reference.digest).toBe(original.digest);
    expect(reference.count).toBe(original.count);
    expect(reference.partitions.map(part=>part.block)).toEqual(Array.from({length:16},(_,block)=>block));
    expect(reference.partitions.map(part=>part.count)).toEqual(new Array<number>(16).fill(4096));
  }
});

it.each((["strict","ignore","replace"] as const).flatMap(policy=>
  decodePartitions.results.filter(row=>row.policy===policy).flatMap(row=>row.partitions.map(part=>({policy,mode:row.mode,...part})))
))("matches every HZ byte pair and split transition with $policy in mode $mode block $block",({policy,mode,block,count:expectedCount,digest})=>{
    withoutErrorStacks(() => {
    const hash=createHash("sha256");let count=0;
    for(let first=block*16;first<(block+1)*16;first++)for(let second=0;second<256;second++){
      const budget=meter(),decoder=new DoubleByteIncrementalDecoder(hzCodec,policy),row:unknown[]=[];
      decoder.setstate([new Uint8Array(),0x123400n+BigInt(mode)],budget);
      for(const [chunk,final] of [[Uint8Array.of(first),false],[Uint8Array.of(second),false],[new Uint8Array(),true],[Uint8Array.of(126,125,65),true]] as const){
        row.push(attempt(()=>decoder.decode(chunk,final,budget)));
        const [pending,state]=decoder.getstate(budget);row.push([[...pending],String(state)]);
      }
      hash.update(JSON.stringify(row)+"\n");count++;
    }
    expect(count).toBe(expectedCount);
    expect(hash.digest("hex")).toBe(digest);
    });
});

it.each(["strict","ignore","replace"] as const)("matches HZ encode shifts, failures, finalization and state with %s",policy=>{
  const hash=createHash("sha256"),alphabet=[65,126,10,0x4e2d,0x6587,0x30fb,0x2015,0xd800,0x1f600];let count=0;
  for(const a of alphabet)for(const b of alphabet)for(const c of alphabet)for(let split=0;split<4;split++){
    const budget=meter(),source=new CodePointString(Uint32Array.of(a,b,c),budget),encoder=new DoubleByteIncrementalEncoder(hzCodec,policy);
    const row:unknown[]=[attempt(()=>hzCodec.encode(source,policy,budget))];
    for(const [chunk,final] of [[source.slice(0n,BigInt(split),null,budget),false],[source.slice(BigInt(split),null,null,budget),false],[CodePointString.fromString("",budget),true],[CodePointString.fromString("A",budget),true]] as const){
      row.push(attempt(()=>encoder.encode(chunk,final,budget)),String(encoder.getstate(budget)));
    }
    hash.update(JSON.stringify(row)+"\n");count++;
  }
  const expected=evidence.results.find(row=>row.kind==="encode"&&row.policy===policy)!;
  expect(count).toBe(expected.count);
  expect(hash.digest("hex")).toBe(expected.digest);
});

it.each(["ignore","replace"] as const)("matches every Unicode point in the stateful %s encoder",policy=>{
  const budget=new ExecutionBudget({maxSteps:16000000,maxAllocatedBytes:128000000});
  const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
  const result=hzCodec.encode(input,policy,budget),expected=evidence.results.find(row=>row.kind==="all-points"&&row.policy===policy)!;
  expect(result.length).toBe(expected.length);
  expect(createHash("sha256").update(result).digest("hex")).toBe(expected.digest);
});
