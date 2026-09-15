import {big5Decode,big5Encode,cp950Decode,cp950Encode} from "./taiwan-data.js";
import {DoubleByteCodec} from "./double-byte-codec.js";

/** Pinned _codecs_tw stateless kernels. The shared incremental machinery takes
 * these codec objects; guest publication and argument conversion are separate. */
export const taiwanCodecs=Object.fromEntries(([
  ["big5",big5Decode,big5Encode],["cp950",cp950Decode,cp950Encode]
] as const).map(([name,decoded,encoded])=>{
  return [name,new DoubleByteCodec(name,(first,second,meter)=>{
    meter.checkpoint();
    if(first<128||first>255||second<0||second>255)return undefined;
    const point=decoded[(first-128)*256+second];
    return point===-1?undefined:point;
  },(point,meter)=>{
    meter.checkpoint();
    if(point<128)return point;
    if(point>0xffff)return undefined;
    let low=0,high=encoded.length/2;
    while(low<high){
      meter.checkpoint();
      const middle=Math.floor((low+high)/2),candidate=encoded[middle*2];
      if(candidate===point)return encoded[middle*2+1];
      if(candidate<point)low=middle+1;
      else high=middle;
    }
    return undefined;
  })];
})) as Readonly<Record<"big5"|"cp950",DoubleByteCodec>>;
