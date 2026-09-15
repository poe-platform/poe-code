import {expect,it} from "vitest";
import {compileGb18030Mappings} from "../scripts/gb18030-data.js";

function source() {
  const table=(name:string,high:number,first:number,data:string)=>{
    const rows=Array.from({length:256},(_,i)=>i===high?`{__${name}+0,${first},${first+2}}`:"{0,0,0}");
    return `static const unsigned short __${name}[3] = {${data}};\nstatic const struct index ${name}[256] = {${rows.join(",")}};`;
  };
  return table("gb18030ext_decmap",161,64,"12288,U,19968")+
    table("gb18030ext_encmap",48,0,"41280,N,41282")+
    "static const struct range gb18030_to_unibmp_ranges[] = {{128,163,0},{165,166,36},{0,0,38}};";
}

it("preserves directional GB18030 extensions and range gaps",()=>{
  const result=compileGb18030Mappings(source());
  expect(result.decode.length).toBe(32768);
  expect(result.decode.slice(0x2140,0x2143)).toEqual([12288,-1,19968]);
  expect(result.encode).toEqual([12288,41280,12290,41282]);
  expect(result.ranges).toEqual([128,163,0,165,166,36]);
});

it.each([
  ["invalid pair",()=>source().replace("41280,N,41282","41343,N,41282")],
  ["unknown sentinel",()=>source().replace("12288,U,19968","12288,HOST,19968")],
  ["invalid Unicode",()=>source().replace("12288,U,19968","1114112,U,19968")],
  ["surrogate mapping",()=>source().replace("12288,U,19968","55296,U,19968")],
  ["invalid pointer",()=>source().replace("__gb18030ext_decmap+0","__other+0")],
  ["missing ranges",()=>source().slice(0,source().indexOf("static const struct range"))],
  ["truncated ranges",()=>source().slice(0,-2)],
  ["nondecimal range",()=>source().replace("128,163,0","0x80,163,0")],
  ["reversed range",()=>source().replace("128,163,0","163,128,0")],
  ["overlapping ranges",()=>source().replace("165,166,36","163,166,36")],
  ["discontinuous indices",()=>source().replace("165,166,36","165,166,37")],
  ["surrogate range",()=>source().replace("165,166,36","55295,57344,36")],
  ["bad terminator",()=>source().replace("0,0,38","0,0,39")],
  ["missing terminator",()=>source().replace(",{0,0,38}","")],
  ["trailing range",()=>source().replace("{0,0,38}","{0,0,38},{168,169,38}")],
  ["duplicate ranges",()=>source()+source().slice(source().indexOf("static const struct range"))]
] as const)("rejects %s",(_name,make)=>expect(()=>compileGb18030Mappings(make())).toThrow());
