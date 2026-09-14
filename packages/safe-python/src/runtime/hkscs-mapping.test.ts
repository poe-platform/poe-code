import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {lookupHkscsPair,lookupHkscsCharacter,lookupHkscsSequence} from "./hkscs-mapping.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
const meter=()=>new ExecutionBudget({maxSteps:8000000,maxAllocatedBytes:16000000});

it("matches all high-leading byte pairs and all Unicode singleton inputs against CPython 3.14.7",()=>{
  const budget=meter(),decoded=Buffer.alloc(32768*8),encoded=Buffer.alloc(0x110000*4);
  let decodeCount=0,encodeCount=0;
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    const points=lookupHkscsPair(first,second,budget),offset=((first-128)*256+second)*8;
    if(points!==undefined)decodeCount++;
    decoded.writeInt32LE(points?.[0]??-1,offset);
    decoded.writeInt32LE(points?.[1]??-1,offset+4);
  }
  for(let point=0;point<0x110000;point++){
    const value=lookupHkscsCharacter(point,budget);
    if(value!==undefined)encodeCount++;
    encoded.writeInt32LE(value??-1,point*4);
  }
  expect([decodeCount,encodeCount]).toEqual([18402,18514]);
  expect(createHash("sha256").update(decoded).digest("hex")).toBe("f0c5602ccafc8109d77e085c16b66c8054350e072baea08439ae054b99cc64d2");
  expect(createHash("sha256").update(encoded).digest("hex")).toBe("23f6a3610c6c3dc985fcbb2203b846771c30a27e3dae488f9a4d99219704dfc1");
});
it.each([[0xca,0x304,0x8862],[0xca,0x30c,0x8864],[0xea,0x304,0x88a3],[0xea,0x30c,0x88a5]])("preserves expansion %i + %i",(first,second,encoded)=>{
  expect(lookupHkscsSequence(first,second,meter())).toBe(encoded);
  const points=lookupHkscsPair(encoded>>8,encoded&255,meter());
  expect(points).toEqual([first,second]);
  expect(Object.isFrozen(points)).toBe(true);
});
it("keeps prefix singleton fallbacks distinct from sequence lookup",()=>{
  expect(lookupHkscsCharacter(0xca,meter())).toBe(0x8866);
  expect(lookupHkscsCharacter(0xea,meter())).toBe(0x88a7);
  expect(lookupHkscsSequence(0xca,0x305,meter())).toBeUndefined();
  expect(lookupHkscsSequence(0xcb,0x304,meter())).toBeUndefined();
});
it("observes terminal cancellation in every lookup",()=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100,signal:controller.signal});
  controller.abort();
  for(const call of [()=>lookupHkscsPair(0x88,0x62,budget),()=>lookupHkscsCharacter(65,budget),()=>lookupHkscsSequence(0xca,0x304,budget)])expect(call).toThrow(ExecutionLimitError);
});
