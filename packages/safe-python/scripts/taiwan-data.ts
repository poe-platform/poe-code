import {readCjkMapping} from "./cjk-mapping-data.js";

type TaiwanMapping={decode:number[];encode:number[]};

/** _codecs_tw.c searches cp950ext before big5 in both directions. Neither
 * encoder can be inferred by reversing a decoder: duplicate mappings differ. */
export function compileTaiwanMappings(source:string):{big5:TaiwanMapping;cp950:TaiwanMapping} {
  const decode=new Array<number>(128*256).fill(-1),encode=new Map<number,number>();
  function pair(bytes:number):number {
    const first=bytes>>8,second=bytes&255;
    if(first<0x81||first>0xfe||!(second>=0x40&&second<=0x7e||second>=0xa1&&second<=0xfe))throw Error("invalid Taiwan codec pair");
    return bytes;
  }
  const result={} as {big5:TaiwanMapping;cp950:TaiwanMapping};
  for(const [name,table] of [["big5","big5"],["cp950","cp950ext"]] as const){
    for(const [bytes,point] of readCjkMapping(source,`${table}_decmap`,"U"))decode[pair(bytes)-0x8000]=point;
    for(const [point,bytes] of readCjkMapping(source,`${table}_encmap`,"N"))encode.set(point,pair(bytes));
    result[name]={decode:decode.slice(),encode:[...encode].sort(([a],[b])=>a-b).flat()};
  }
  return result;
}
