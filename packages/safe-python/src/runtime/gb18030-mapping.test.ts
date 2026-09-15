import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {lookupGb18030Pair,lookupGb18030Quad,lookupGb18030Character} from "./gb18030-mapping.js";

const meter=()=>new ExecutionBudget({maxSteps:40000000,maxAllocatedBytes:16000000});

// Independent CPython 3.14.7 / Unicode 16.0.0 oracle. Fixed-width signed
// little-endian records preserve unmapped entries (-1) as well as all mappings.
it("matches all 32,768 high-leading pairs",()=>{
  const records=Buffer.alloc(32768*4),budget=meter();
  let offset=0,count=0;
  for(let first=128;first<256;first++)for(let second=0;second<256;second++){
    const point=lookupGb18030Pair(first,second,budget);
    if(point!==undefined)count++;
    records.writeInt32LE(point??-1,offset);offset+=4;
  }
  expect(count).toBe(23940);
  expect(createHash("sha256").update(records).digest("hex")).toBe("83f25c4d71eeeb02d983a6281a06bd8004553bf412a4961d6c10b70b6107b3ee");
});

it("matches the entire 1,587,600-entry four-byte index space including unmapped gaps",()=>{
  const records=Buffer.alloc(1587600*4),budget=meter();
  let offset=0,count=0;
  for(let a=129;a<255;a++)for(let b=48;b<58;b++)for(let c=129;c<255;c++)for(let d=48;d<58;d++){
    const point=lookupGb18030Quad(a,b,c,d,budget);
    if(point!==undefined)count++;
    records.writeInt32LE(point??-1,offset);offset+=4;
  }
  expect(count).toBe(1087996);
  expect(createHash("sha256").update(records).digest("hex")).toBe("76169a0b7a4c54de4ed35067a84c7a15740037697a5e683f99e0a0915d18d762");
});

it("matches every Unicode point including all surrogate failures",()=>{
  const records=Buffer.alloc(0x110000*8),budget=meter();
  let count=0;
  for(let point=0;point<=0x10ffff;point++){
    const bytes=lookupGb18030Character(point,budget);
    if(bytes!==undefined)count++;
    records.writeBigInt64LE(BigInt(bytes??-1),point*8);
  }
  expect(count).toBe(1112064);
  expect(createHash("sha256").update(records).digest("hex")).toBe("9cff6a1fd5ccdd82473432bc430b0a5c48ec993cb96bca16c42937111c4854d9");
});

it.each([0,1,2,3])("rejects invalid bytes in four-byte position %i",position=>{
  const valid=[0x81,0x30,0x81,0x30],budget=meter();
  for(let byte=0;byte<256;byte++){
    if(position%2===0?byte>=0x81&&byte<=0xfe:byte>=0x30&&byte<=0x39)continue;
    const input=valid.slice();input[position]=byte;
    expect(lookupGb18030Quad(input[0],input[1],input[2],input[3],budget)).toBeUndefined();
  }
});

it("checks cancellation before ASCII, BMP and supplementary mapping paths",()=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100,signal:controller.signal});
  controller.abort();
  for(const operation of [()=>lookupGb18030Pair(129,64,budget),()=>lookupGb18030Quad(129,48,129,48,budget),()=>lookupGb18030Quad(144,48,129,48,budget),... [65,128,0x4e00,0x10000,0xd800].map(point=>()=>lookupGb18030Character(point,budget))]){
    expect(operation).toThrow(ExecutionLimitError);
  }
});
