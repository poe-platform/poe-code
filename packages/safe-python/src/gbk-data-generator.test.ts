import {expect,it} from "vitest";
import {compileGbkMappings} from "../scripts/gbk-data.js";

function source(extension="19968,U,19969",encoder="8481,N,33088,33089") {
  const rows=(index:number,value:string)=>Array.from({length:256},(_,i)=>i===index?value:"{0,0,0}").join(",\n");
  return `static const ucs2_t __gb2312_decmap[3] = {12288,U,12539};
static const struct dbcs_index gb2312_decmap[256] = {${rows(33,"{__gb2312_decmap+0,33,35}")}};
static const ucs2_t __gbkext_decmap[3] = {${extension}};
static const struct dbcs_index gbkext_decmap[256] = {${rows(129,"{__gbkext_decmap+0,64,66}")}};
static const DBCHAR __gbcommon_encmap[4] = {${encoder}};
static const struct unim_index gbcommon_encmap[256] = {${rows(48,"{__gbcommon_encmap+0,0,3}")}};`;
}

it("combines the independent GB2312, GBK extension and common encoder maps",()=>{
  const result=compileGbkMappings(source());
  const at=(first:number,second:number)=>result.decode[(first-128)*256+second];
  expect(result.decode.length).toBe(128*256);
  expect(at(0xa1,0xa1)).toBe(12288);
  expect(at(0xa1,0xa2)).toBe(-1);
  expect(at(0x81,0x40)).toBe(19968);
  expect(at(0x81,0x41)).toBe(-1);
  expect(at(0x81,0x42)).toBe(19969);
  expect(result.encode).toEqual([0xb7,0xa1a4,0x2014,0xa1aa,0x2015,0xa844,0x3000,0xa1a1,0x3002,0x8140,0x3003,0x8141]);
});

it("applies the three native GBK overrides independently of table inversion",()=>{
  const result=compileGbkMappings(source());
  const at=(first:number,second:number)=>result.decode[(first-128)*256+second];
  expect(at(0xa1,0xa4)).toBe(0xb7);
  expect(at(0xa1,0xaa)).toBe(0x2014);
  expect(at(0xa8,0x44)).toBe(0x2015);
  const own=source().replace("{__gbcommon_encmap+0,0,3}","{__gbcommon_encmap+0,248,251}");
  expect(compileGbkMappings(own).encode).not.toContain(0x30fb);
});

it.each([
  ["unknown token",()=>source("19968,HOST_VALUE,19969")],
  ["truncated declaration",()=>source().slice(0,-2)],
  ["bad pointer",()=>source().replace("__gbkext_decmap+0","__gbcommon_encmap+0")],
  ["out of bounds offset",()=>source().replace("__gbkext_decmap+0","__gbkext_decmap+2")],
  ["invalid Unicode mapping",()=>source("1114112,U,19969")],
  ["invalid GB2312 encoder pair",()=>source(undefined,"1,N,33088,33089")],
  ["invalid GBK encoder pair",()=>source(undefined,"8481,N,32832,33089")],
  ["invalid GBK trail",()=>source(undefined,"8481,N,33151,33089")]
] as const)("rejects %s",(_name,make)=>{
  expect(()=>compileGbkMappings(make())).toThrow();
});
