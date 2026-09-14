import {jisx0208_decmap,jisxcommon_encmap} from "./cp932-data.js";
import {jisx0212_decmap} from "./euc-jp-data.js";
import {DoubleByteCodec} from "./double-byte-codec.js";
import type {ExecutionMeter} from "./execution-budget.js";

function lookup(table:readonly number[],key:number,meter:ExecutionMeter):number|undefined {
  let low=0,high=table.length/2;
  while(low<high){
    meter.checkpoint();
    const middle=Math.floor((low+high)/2),candidate=table[middle*2];
    if(candidate===key)return table[middle*2+1];
    if(candidate<key)low=middle+1;
    else high=middle;
  }
  return undefined;
}

function lookupPair(first:number,second:number,meter:ExecutionMeter):number|undefined {
  if(first===0x8e)return second>=0xa1&&second<=0xdf?second+0xfec0:undefined;
  // The pinned non-STRICT_BUILD selects the full-width reverse solidus.
  if(first===0xa1&&second===0xc0)return 0xff3c;
  return lookup(jisx0208_decmap,(first^0x80)*256+(second^0x80),meter);
}

function lookupCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<0x80)return point;
  if(point>0xffff)return undefined;
  const common=lookup(jisxcommon_encmap,point,meter);
  if(common!==undefined)return common&0x8000?0x8f0000+common+0x80:common|0x8080;
  if(point>=0xff61&&point<=0xff9f)return 0x8e00+point-0xfec0;
  if(point===0xff3c)return 0xa1c0;
  if(point===0xa5)return 0x5c;
  if(point===0x203e)return 0x7e;
  return undefined;
}

/** CPython 3.14.7 EUC-JP with independently pinned JIS encode/decode tables.
 * SS2 carries half-width kana; SS3 requires three bytes before validation.
 * Recovery, pending input and opaque state belong to the shared engines. */
export const eucJpCodec=new DoubleByteCodec("euc_jp",lookupPair,lookupCharacter,undefined,undefined,{
  read(input,position,_state,meter){
    meter.checkpoint(1,32);
    const first=input[position];
    if(first<0x80)return {width:1,points:[first]};
    const width=first===0x8f?3:2;
    if(position+width>input.length)return "incomplete";
    const point=width===3?lookup(jisx0212_decmap,(input[position+1]^0x80)*256+(input[position+2]^0x80),meter)
      :lookupPair(first,input[position+1],meter);
    return point===undefined?"invalid":{width,points:[point]};
  },
  write(point,_state,meter){
    const encoded=lookupCharacter(point,meter);
    if(encoded===undefined)return undefined;
    meter.checkpoint(0,encoded<256?40:encoded<65536?48:56);
    return encoded<256?[encoded]:encoded<65536?[encoded>>8,encoded&255]:[encoded>>16,(encoded>>8)&255,encoded&255];
  },
  reset(_state,meter){meter.checkpoint();return [];}
});
