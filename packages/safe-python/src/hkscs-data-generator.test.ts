import {expect,it} from "vitest";
import {compileHkscsMappings} from "../scripts/hkscs-data.js";

function table(name:string,entries:readonly (readonly [number,string])[]):string {
  const rows=Array.from({length:256},()=>"{0,0,0}"),data:string[]=[];
  for(const [key,value] of entries){
    rows[key>>8]=`{__${name}+${data.length},${key&255},${key&255}}`;
    data.push(value);
  }
  return `static const unsigned short __${name}[${data.length}] = {${data.join(",")}};\nstatic const struct index ${name}[256] = {${rows.join(",")}};`;
}
function sources(){
  const hints=[[0,621],[12130,60],[21924,125]].map(([name,size])=>`static const unsigned char big5hkscs_phint_${name}[] = {${Array.from({length:size},(_,i)=>name===0&&i===0?1:0).join(",")},};`).join("\n");
  return {base:table("big5_decmap",[[0xa140,"12288"],[0xc7a1,"12345"]])+table("big5_encmap",[[0x3000,"41280"]]),
    hk:table("big5hkscs_decmap",[[0x8740,"1"],[0xa140,"1234"],[0xc7a1,"20000"]])+table("big5hkscs_bmp_encmap",[[0x3000,"34624"]])+table("big5hkscs_nonbmp_encmap",[[1,"34624"]])+hints};
}
it("preserves base precedence, excluded base rows, plane hints and independent encoders",()=>{
  const {base,hk}=sources(),result=compileHkscsMappings(base,hk);
  expect(result.decode[0x740]).toBe(0x20001);
  expect(result.decode[0x2140]).toBe(12288);
  expect(result.decode[0x47a1]).toBe(20000);
  expect(result.encode).toContain(0x20001);
  expect(result.encode.slice(result.encode.indexOf(0x3000),result.encode.indexOf(0x3000)+2)).toEqual([0x3000,34624]);
  expect(result.expansions).toEqual([0x8862,0xca,0x304,0x8864,0xca,0x30c,0x88a3,0xea,0x304,0x88a5,0xea,0x30c]);
});
it.each([
  ["invalid hint",(source:string)=>source.replace("{1,0,0,","{256,0,0,")],
  ["short hints",(source:string)=>source.replace("{1,0,0,","{1,")],
  ["invalid pair",(source:string)=>source.replace("34624","34559")],
  ["invalid sequence marker",(source:string)=>source.replace("34624","M")],
  ["truncated source",(source:string)=>source.slice(0,-2)],
] as const)("rejects %s",(_name,mutate)=>{const {base,hk}=sources();expect(()=>compileHkscsMappings(base,mutate(hk))).toThrow();});
it("preserves the native multi-character sentinel and its singleton fallback",()=>{
  const {base,hk}=sources();
  const result=compileHkscsMappings(base,hk.replace(table("big5hkscs_bmp_encmap",[[0x3000,"34624"]]),table("big5hkscs_bmp_encmap",[[0xca,"M"]])));
  expect(result.encode.slice(0,2)).toEqual([0xca,0x8866]);
});
