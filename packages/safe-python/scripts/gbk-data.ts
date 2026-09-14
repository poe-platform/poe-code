import {readCjkMapping} from "./cjk-mapping-data.js";

/** GBK_DECODE/GBK_ENCODE in pinned _codecs_cn.c combine these independent
 * mappings and three overrides. The encoder must not invert the decoder. */
export function compileGbkMappings(source:string):{decode:number[];encode:number[]} {
  const decode=new Array<number>(128*256).fill(-1),encoded=new Map<number,number>();
  function gb2312Pair(bytes:number):number {
    const first=bytes>>8,second=bytes&255;
    if(first<33||first>126||second<33||second>126)throw Error("invalid GB2312 pair");
    return bytes|0x8080;
  }
  function gbkPair(bytes:number):number {
    const first=bytes>>8,second=bytes&255;
    if(first<0x81||first>0xfe||second<0x40||second>0xfe||second===0x7f)throw Error("invalid GBK pair");
    return bytes;
  }
  for(const [bytes,point] of readCjkMapping(source,"gbkext_decmap","U"))decode[gbkPair(bytes)-0x8000]=point;
  // The native decoder prefers GB2312 when a pair exists in both tables.
  for(const [bytes,point] of readCjkMapping(source,"gb2312_decmap","U"))decode[gb2312Pair(bytes)-0x8000]=point;
  for(const [point,bytes] of readCjkMapping(source,"gbcommon_encmap","N")){
    if(point!==0x30fb)encoded.set(point,bytes&0x8000?gbkPair(bytes):gb2312Pair(bytes));
  }
  for(const [point,bytes] of [[0xb7,0xa1a4],[0x2014,0xa1aa],[0x2015,0xa844]]){
    decode[bytes-0x8000]=point;
    encoded.set(point,bytes);
  }
  return {decode,encode:[...encoded].sort(([a],[b])=>a-b).flat()};
}
