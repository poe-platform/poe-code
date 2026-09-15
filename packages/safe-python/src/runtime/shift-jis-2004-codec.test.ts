import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {shiftJis2004Codec} from "./shift-jis-2004-codec.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
const text=(source:string)=>CodePointString.fromString(source,meter());

it("encodes JIS X 0213 pairs before singleton mappings and retains split prefixes",()=>{
  const budget=meter(),encoder=new DoubleByteIncrementalEncoder(shiftJis2004Codec,"strict");
  expect([...encoder.encode(text("か"),false,budget)]).toEqual([]);
  expect([...encoder.encode(text("\u309a"),true,budget)]).toEqual([0x82,0xf5]);
  expect([...shiftJis2004Codec.encode(text("か\0"),"strict",budget)]).toEqual([0x82,0xa9,0]);
});

it("decodes JIS Roman singles and split combining pairs",()=>{
  const budget=meter(),decoder=new DoubleByteIncrementalDecoder(shiftJis2004Codec,"strict");
  expect([...decoder.decode(Uint8Array.of(0x5c,0x7e,0x82),false,budget)]).toEqual([0xa5,0x203e]);
  expect([...decoder.decode(Uint8Array.of(0xf5),true,budget)]).toEqual([0x304b,0x309a]);
});
