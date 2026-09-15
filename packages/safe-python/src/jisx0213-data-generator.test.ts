import {expect,it} from "vitest";
import {readCjkMapping} from "../scripts/cjk-mapping-data.js";
import {readJisPairs} from "../scripts/jisx0213-data.js";

it("reads packed two-character decode mappings without permitting oversized scalar tables",()=>{
  const rows=Array.from({length:256},(_,i)=>i===0?"{__pair+0,0,0}":"{0,0,0}");
  const source=`static const Py_UCS4 __pair[1] = {810234010}; static const index pair[256] = {${rows.join(",")}};`;
  expect(()=>readCjkMapping(source,"pair","U")).toThrow("invalid mapping");
  expect(readCjkMapping(source,"pair","U",{},0xffffffff)).toEqual([[0,810234010]]);
});

it("parses and validates independent pair encoder records",()=>{
  const source="static const struct pair_encodemap jisx0213_pair_encmap[JISX0213_ENCPAIRS] = { {0x304b0000,0x242b}, {0x304b309a,0x2477}, };";
  expect(readJisPairs(source,2)).toEqual([0x304b0000,0x242b,0x304b309a,0x2477]);
  expect(()=>readJisPairs(source,3)).toThrow();
  expect(()=>readJisPairs(source.replace("0x2477","0x10000"),2)).toThrow();
  expect(()=>readJisPairs(source.replace("0x304b309a","0x304b0000"),2)).toThrow();
  expect(()=>readJisPairs(source.replace("0x2477","eval()"),2)).toThrow();
});
