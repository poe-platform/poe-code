import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {lookupGb2312Character,lookupGb2312Pair} from "./gb2312-mapping.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

// External oracle: CPython 3.14.7 / Unicode 16.0.0, little endian. Each digest
// includes every input in order as an int32 LE result; -1 denotes unmappable.
// Python participates only in recording these expectations, never in tests.
it("matches every high-leading byte pair against the pinned GB2312 oracle",()=>{
  const data=Buffer.alloc(128*256*4);
  let count=0;
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    const point=lookupGb2312Pair(first,second);
    if(point!==undefined)count++;
    data.writeInt32LE(point??-1,((first-128)*256+second)*4);
  }
  expect(count).toBe(7445);
  expect(createHash("sha256").update(data).digest("hex")).toBe("9b7963bad50bf5ccb4463df469329ff44672b97d937977b4aaa587f3a027d3ea");
});

it("matches all Unicode code points, including surrogates and non-BMP unmappables",()=>{
  const data=Buffer.alloc(0x110000*4);
  let count=0;
  for(let point=0;point<0x110000;point++){
    const bytes=lookupGb2312Character(point);
    if(bytes!==undefined)count++;
    data.writeInt32LE(bytes??-1,point*4);
  }
  expect(count).toBe(7573);
  expect(createHash("sha256").update(data).digest("hex")).toBe("6cd864f7936842477545de2707570ba3e838b384698e2251e35e68948b69b930");
});

it("retains GB2312 mappings that differ from GBK",()=>{
  expect(lookupGb2312Pair(0xa1,0xa4)).toBe(0x30fb);
  expect(lookupGb2312Pair(0xa1,0xaa)).toBe(0x2015);
  expect(lookupGb2312Character(0x30fb)).toBe(0xa1a4);
  expect(lookupGb2312Character(0x2015)).toBe(0xa1aa);
  expect(lookupGb2312Character(0xb7)).toBeUndefined();
  expect(lookupGb2312Character(0x2014)).toBeUndefined();
});

it("observes cancellation even for ASCII and unmappable inputs",()=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  controller.abort();
  for(const call of [()=>lookupGb2312Character(65,meter),()=>lookupGb2312Character(0x10000,meter),()=>lookupGb2312Pair(0xa1,0xa4,meter),()=>lookupGb2312Pair(255,0,meter)]){
    expect(call).toThrow(ExecutionLimitError);
  }
});
