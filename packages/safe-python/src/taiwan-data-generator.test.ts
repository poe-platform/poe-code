import {expect,it} from "vitest";
import {compileTaiwanMappings} from "../scripts/taiwan-data.js";

function source() {
  const table=(name:string,high:number,first:number,data:string)=>{
    const rows=Array.from({length:256},(_,i)=>i===high?`{__${name}+0,${first},${first+2}}`:"{0,0,0}");
    return `static const unsigned short __${name}[3] = {${data}};\nstatic const struct index ${name}[256] = {${rows.join(",")}};`;
  };
  return table("big5_decmap",161,64,"12288,U,19968")+
    table("big5_encmap",48,0,"41280,N,41282")+
    table("cp950ext_decmap",161,64,"8364,19969,U")+
    table("cp950ext_encmap",48,0,"41281,41282,N");
}

it("preserves directional tables and gives CP950 extensions precedence",()=>{
  const {big5,cp950}=compileTaiwanMappings(source());
  expect(big5.decode.length).toBe(32768);
  expect(big5.decode.slice(0x2140,0x2143)).toEqual([12288,-1,19968]);
  expect(cp950.decode.slice(0x2140,0x2143)).toEqual([8364,19969,19968]);
  expect(big5.encode).toEqual([12288,41280,12290,41282]);
  expect(cp950.encode).toEqual([12288,41281,12289,41282,12290,41282]);
});

it.each([
  ["invalid decoder trail",()=>source().replace("{__big5_decmap+0,64,66}","{__big5_decmap+0,63,65}")],
  ["invalid encoder trail",()=>source().replace("41280,N,41282","41343,N,41282")],
  ["invalid encoder lead",()=>source().replace("41280,N,41282","32576,N,41282")],
  ["unknown sentinel",()=>source().replace("12288,U,19968","12288,HOST,19968")],
  ["invalid Unicode",()=>source().replace("12288,U,19968","1114112,U,19968")],
  ["invalid pointer",()=>source().replace("__cp950ext_decmap+0","__big5_decmap+0")],
  ["truncated table",()=>source().slice(0,-2)]
] as const)("rejects %s",(_name,make)=>expect(()=>compileTaiwanMappings(make())).toThrow());
