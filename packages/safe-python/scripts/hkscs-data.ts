import {readCjkMapping} from "./cjk-mapping-data.js";

/** Native _codecs_hk.c expansions are separate from scalar lookup tables.
 * Entries are encoded pair, first Unicode point, second Unicode point. */
const expansions=[0x8862,0xca,0x304,0x8864,0xca,0x30c,0x88a3,0xea,0x304,0x88a5,0xea,0x30c];
const hintRanges=[[0,0x8740,0xa0fe],[12130,0xc6a1,0xc8fe],[21924,0xf9d6,0xfefe]] as const;
const hintIndex=(pair:number)=>(pair>>8)*191+(pair&255);

export function compileHkscsMappings(base:string,source:string):{decode:number[];encode:number[];expansions:number[]} {
  const decode=new Array<number>(32768).fill(-1),encode=new Map<number,number>();
  function pair(value:number):number {
    const high=value>>8,low=value&255;
    if(high<0x81||high>0xfe||!(low>=0x40&&low<=0x7e||low>=0xa1&&low<=0xfe))throw Error("invalid HKSCS byte pair");
    return value;
  }
  const hints=hintRanges.map(([name,start,end])=>{
    const marker=` big5hkscs_phint_${name}[]`,at=source.indexOf(marker),open=source.indexOf("{",at),close=source.indexOf("}",open);
    if(at<0||source.indexOf(marker,at+marker.length)>=0||open<0||close<0||source.slice(at+marker.length,open).trim()!=="=")throw Error("invalid HKSCS plane hints");
    const tokens=source.slice(open+1,close).split(",").map(token=>token.trim());
    if(tokens.at(-1)==="")tokens.pop();
    const bytes=tokens.map(token=>{
      if(!token||[...token].some(char=>char<"0"||char>"9"))throw Error("invalid HKSCS hint byte");
      const value=Number(token);
      if(value>255)throw Error("invalid HKSCS hint byte");
      return value;
    });
    if(bytes.length!==Math.ceil((hintIndex(end)-hintIndex(start)+1)/8))throw Error("invalid HKSCS hint length");
    return {start,end,bytes};
  });
  for(const [bytes,point] of readCjkMapping(base,"big5_decmap","U")){
    pair(bytes);
    // The C6A1..C8FE portion is replaced, not extended, by HKSCS.
    if(bytes<0xc6a1||bytes>0xc8fe)decode[bytes-0x8000]=point;
  }
  for(const [bytes,point] of readCjkMapping(source,"big5hkscs_decmap","U")){
    pair(bytes);
    if(decode[bytes-0x8000]!==-1)continue;
    const hint=hints.find(range=>bytes>=range.start&&bytes<=range.end);
    if(hint===undefined)throw Error("HKSCS mapping outside plane hints");
    const index=hintIndex(bytes)-hintIndex(hint.start);
    decode[bytes-0x8000]=point|((hint.bytes[index>>3]&(1<<(index&7)))!==0?0x20000:0);
  }
  for(const [point,bytes] of readCjkMapping(base,"big5_encmap","N"))encode.set(point,pair(bytes));
  for(const [point,bytes] of readCjkMapping(source,"big5hkscs_bmp_encmap","N",{M:-2})){
    if(bytes===-2){
      if(point!==0xca&&point!==0xea)throw Error("invalid HKSCS sequence prefix");
      encode.set(point,point===0xca?0x8866:0x88a7);
    }else encode.set(point,pair(bytes));
  }
  for(const [point,bytes] of readCjkMapping(source,"big5hkscs_nonbmp_encmap","N"))encode.set(point|0x20000,pair(bytes));
  return {decode,encode:[...encode].sort(([a],[b])=>a-b).flat(),expansions:expansions.slice()};
}
