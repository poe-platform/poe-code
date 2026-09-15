import {expect,it} from "vitest";
import {compileCp949Mappings} from "../scripts/cp949-data.js";

function source(encoder="8481,N,33089,33090") {
  const rows=(index:number,value:string)=>Array.from({length:256},(_,i)=>i===index?value:"{0,0,0}").join(",\n");
  return `static const ucs2_t __ksx1001_decmap[3] = {12288,U,12290};
static const struct dbcs_index ksx1001_decmap[256] = {${rows(33,"{__ksx1001_decmap+0,33,35}")}};
static const ucs2_t __cp949ext_decmap[3] = {44034,U,44035};
static const struct dbcs_index cp949ext_decmap[256] = {${rows(129,"{__cp949ext_decmap+0,65,67}")}};
static const DBCHAR __cp949_encmap[4] = {${encoder}};
static const struct unim_index cp949_encmap[256] = {${rows(48,"{__cp949_encmap+0,0,3}")}};`;
}

it("combines KS X 1001 and UHC decoding with an independent native encoder map",()=>{
  const result=compileCp949Mappings(source());
  expect(result.decode).toHaveLength(128*256);
  expect(result.decode[0xa1a1-0x8000]).toBe(12288);
  expect(result.decode[0xa1a2-0x8000]).toBe(-1);
  expect(result.decode[0x8141-0x8000]).toBe(44034);
  expect(result.decode[0x8142-0x8000]).toBe(-1);
  expect(result.decode[0x8143-0x8000]).toBe(44035);
  expect(result.encode).toEqual([0x3000,0xa1a1,0x3002,0x8141,0x3003,0x8142]);
});

it.each([
  ["unknown token",()=>source("8481,N,HOST_VALUE,33090")],
  ["truncated table",()=>source().slice(0,-2)],
  ["invalid pointer",()=>source().replace("__cp949ext_decmap+0","__cp949_encmap+0")],
  ["out of bounds pointer",()=>source().replace("__cp949ext_decmap+0","__cp949ext_decmap+3")],
  ["invalid Unicode point",()=>source().replace("44034,U,44035","1114112,U,44035")],
  ["invalid KS X 1001 pair",()=>source("1,N,33089,33090")],
  ["invalid extension lead",()=>source("8481,N,32833,33090")],
  ["invalid extension trail",()=>source("8481,N,33115,33090")]
] as const)("rejects %s",(_name,make)=>{
  expect(()=>compileCp949Mappings(make())).toThrow();
});
