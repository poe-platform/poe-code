import {big5Decode,big5Encode,cp950Decode,cp950Encode} from "./big5-data.js";
import {DoubleByteCodec} from "./double-byte-codec.js";

/** CPython's Taiwan codecs share the stateless native multibyte machine.
 * The generated directions preserve CP950 extension precedence and duplicate
 * encoding choices. Neither Unicode normalization nor host codecs participate.
 */
export const big5Codecs:Readonly<Record<"big5"|"cp950",DoubleByteCodec>>=Object.freeze(Object.fromEntries(
  ([["big5",big5Decode,big5Encode],["cp950",cp950Decode,cp950Encode]] as const).map(([name,decode,encode])=>[
    name,new DoubleByteCodec(name,(first,second,meter)=>{
      meter.checkpoint();
      if(first<128||first>255||second<0||second>255)return undefined;
      const point=decode[(first-128)*256+second];
      return point===-1?undefined:point;
    },(point,meter)=>{
      meter.checkpoint();
      if(point<128)return point;
      if(point>0xffff)return undefined;
      let low=0,high=encode.length/2;
      while(low<high){
        meter.checkpoint();
        const middle=Math.floor((low+high)/2),candidate=encode[middle*2];
        if(candidate===point)return encode[middle*2+1];
        if(candidate<point)low=middle+1;
        else high=middle;
      }
      return undefined;
    })
  ])
) as Record<"big5"|"cp950",DoubleByteCodec>);
