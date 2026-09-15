import {jisx0212_decmap} from "./euc-jp-data.js";
import {lookupCp949Character,lookupCp949Pair} from "./cp949-mapping.js";
import {lookupGb2312Character,lookupGb2312Pair} from "./gb2312-mapping.js";
import {PythonRuntimeError} from "./error.js";
import {createIso2022JpCodec} from "./iso2022-jp-codec.js";

/** CPython 3.14.7 _codecs_iso2022.c: JP-2 prefers JIS 0208/0212,
 * then KS X 1001 and GB2312, then Roman. ISO-8859 G2 designations are
 * decode-only. The Greek mapping is the native ISO-2022 table, distinct
 * from the newer standalone ISO-8859-7 codec table. */
export const iso2022Jp2Codec=createIso2022JpCodec("iso2022_jp_2",jisx0212_decmap,false,{
  designations:[
    {mark:195,width:2,
      decode(first,second,meter){
        meter.checkpoint();
        if(first<0x21||first>0x7e||second<0x21||second>0x7e)return undefined;
        return lookupCp949Pair(first+128,second+128,meter);
      },
      encode(point,meter){
        const encoded=lookupCp949Character(point,meter);
        return encoded!==undefined&&(encoded>>8)>=0xa1&&(encoded&255)>=0xa1?encoded&0x7f7f:undefined;
      }},
    {mark:193,width:2,
      decode(first,second,meter){return lookupGb2312Pair(first+128,second+128,meter);},
      encode(point,meter){const encoded=lookupGb2312Character(point,meter);return encoded===undefined?undefined:encoded&0x7f7f;}},
    // These designations are accepted in G0/G1 but every ordinary character
    // there is unmappable; only the G2 single-shift operation decodes them.
    {mark:65,width:1},
    {mark:70,width:1}
  ],
  singleShift(byte,charset,meter){
    meter.checkpoint();
    if(charset===65)return byte<128?byte+128:undefined;
    if(charset===66)return byte<128?byte:undefined;
    if(charset!==70){
      // Restored G2 state can reject without passing through Unicode recovery.
      // Admit the native exception before exposing a catchable guest failure.
      meter.checkpoint(0,192);
      throw new PythonRuntimeError("RuntimeError","internal codec error");
    }
    const point=byte^128;
    if(point<0xa0||point<0xc0&&(0x288f3bc9&(1<<(point-0xa0))))return point;
    if(point>=0xb4&&point<=0xfe&&(point>=0xd4||(0xbffffd77&(1<<(point-0xb4)))))return 0x2d0+point;
    if(point===0xa1)return 0x2018;
    if(point===0xa2)return 0x2019;
    if(point===0xaf)return 0x2015;
    return undefined;
  }
});
