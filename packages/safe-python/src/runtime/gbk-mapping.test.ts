import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {lookupGbkCharacter,lookupGbkPair} from "./gbk-mapping.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

// External CPython 3.14.7 / Unicode 16.0.0 oracle, int32 LE per input in
// enumeration order (-1 for unmappable). No host Python runs in unit tests.
it("matches every high-leading byte pair against the pinned GBK oracle",()=>{
  const data=Buffer.alloc(128*256*4);
  let count=0;
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    const point=lookupGbkPair(first,second);
    if(point!==undefined)count++;
    data.writeInt32LE(point??-1,((first-128)*256+second)*4);
  }
  expect(count).toBe(21791);
  expect(createHash("sha256").update(data).digest("hex")).toBe("563f65b2936d653e6d019a41b26feff27b2e560a7d974e05d2aa9f22329dca54");
});

it("matches every Unicode point including all surrogate and non-BMP inputs",()=>{
  const data=Buffer.alloc(0x110000*4);
  let count=0;
  for(let point=0;point<0x110000;point++){
    const bytes=lookupGbkCharacter(point);
    if(bytes!==undefined)count++;
    data.writeInt32LE(bytes??-1,point*4);
  }
  expect(count).toBe(21919);
  expect(createHash("sha256").update(data).digest("hex")).toBe("da315a816f8d28ddfb2815a4fcb011e978d429221769d31cf8dbd33f091c08d2");
});

it("preserves GBK overrides and rejects the single-byte euro extension",()=>{
  for(const [point,bytes] of [[0xb7,0xa1a4],[0x2014,0xa1aa],[0x2015,0xa844]]){
    expect(lookupGbkCharacter(point)).toBe(bytes);
    expect(lookupGbkPair(bytes>>8,bytes&255)).toBe(point);
  }
  expect(lookupGbkCharacter(0x30fb)).toBeUndefined();
  expect(lookupGbkCharacter(0x20ac)).toBeUndefined();
  expect(lookupGbkPair(0x80,65)).toBeUndefined();
});

it("checks cancellation for ASCII, table hits and unmappable inputs",()=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  controller.abort();
  for(const call of [()=>lookupGbkCharacter(65,meter),()=>lookupGbkCharacter(0x2015,meter),()=>lookupGbkCharacter(0x10000,meter),()=>lookupGbkPair(0xa1,0xa4,meter),()=>lookupGbkPair(0x80,0,meter)]){
    expect(call).toThrow(ExecutionLimitError);
  }
});
