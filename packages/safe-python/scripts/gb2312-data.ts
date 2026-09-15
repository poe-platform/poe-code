import {readCjkMapping} from "./cjk-mapping-data.js";

/** Compile the independently pinned GB2312 decoder and common encoder data. */
export function compileGb2312Mappings(source:string):{decode:number[];encode:number[]} {
  const decode=new Array<number>(94*94).fill(-1),encode:number[]=[];
  const pair=(value:number)=>{
    const high=value>>8,low=value&255;
    if(high<33||high>126||low<33||low>126)throw Error("invalid GB2312 pair");
    return (high-33)*94+low-33;
  };
  for(const [bytes,point] of readCjkMapping(source,"gb2312_decmap","U"))decode[pair(bytes)]=point;
  // gbcommon includes GBK mappings whose high bit is set. CPython's GB2312
  // encoder rejects those, and does not derive its encoder by reversing decode.
  for(const [point,bytes] of readCjkMapping(source,"gbcommon_encmap","N")){
    if(bytes&0x8000)continue;
    pair(bytes);
    encode.push(point,bytes|0x8080);
  }
  return {decode,encode};
}
