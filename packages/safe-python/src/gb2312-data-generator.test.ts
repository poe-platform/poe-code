import {expect,it} from "vitest";
import {compileGb2312Mappings} from "../scripts/gb2312-data.js";

function source(dec="12288,U,12539",enc="8481,N,8483,32768") {
  const rows=(index:number,value:string)=>Array.from({length:256},(_,i)=>i===index?value:"{0,0,0}").join(",\n");
  return `static const ucs2_t __gb2312_decmap[3] = {${dec}};
static const struct dbcs_index gb2312_decmap[256] = {${rows(33,"{__gb2312_decmap+0,33,35}")}};
static const DBCHAR __gbcommon_encmap[4] = {${enc}};
static const struct unim_index gbcommon_encmap[256] = {${rows(48,"{__gbcommon_encmap+0,0,3}")}};`;
}

it("compiles independent CPython decode and encode maps, excluding GBK-only entries",()=>{
  const result=compileGb2312Mappings(source());
  expect(result.decode.length).toBe(94*94);
  expect(result.decode.slice(0,4)).toEqual([12288,-1,12539,-1]);
  expect(result.encode).toEqual([12288,0xa1a1,12290,0xa1a3]);
});

it.each([
  ["truncated initializer",()=>source().slice(0,-2)],
  ["unknown token",()=>source("12288,HOST_VALUE,12539")],
  ["incorrect data length",()=>source("12288,U")],
  ["out of bounds offset",()=>source().replace("__gb2312_decmap+0","__gb2312_decmap+2")],
  ["wrong pointer",()=>source().replace("__gb2312_decmap+0","__gbcommon_encmap+0")],
  ["invalid mapping",()=>source("1114112,U,12539")],
  ["invalid GB2312 encoding",()=>source(undefined,"1,N,8483,32768")]
] as const)("rejects %s rather than silently emitting a changed table",(_name,make)=>{
  expect(()=>compileGb2312Mappings(make())).toThrow();
});
