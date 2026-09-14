import {jisx0208_decmap,jisxcommon_encmap} from "./cp932-data.js";
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
  if(!(first>=0x81&&first<=0x9f||first>=0xe0&&first<=0xea)||second<0x40||second===0x7f||second>0xfc)return undefined;
  const trail=second<0x80?second-0x40:second-0x41;
  const row=2*(first<0xe0?first-0x81:first-0xc1)+(trail<0x5e?0:1)+0x21;
  const column=(trail<0x5e?trail:trail-0x5e)+0x21;
  // The pinned non-STRICT_BUILD uses the full-width reverse solidus here.
  return row===0x21&&column===0x40?0xff3c:lookup(jisx0208_decmap,row*256+column,meter);
}

function lookupCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<0x80)return point;
  if(point===0xa5)return 0x5c;
  if(point===0x203e)return 0x7e;
  if(point>=0xff61&&point<=0xff9f)return point-0xfec0;
  if(point>0xffff)return undefined;
  const common=lookup(jisxcommon_encmap,point,meter)??(point===0xff3c?0x2140:undefined);
  if(common===undefined||common&0x8000)return undefined;
  const row=(common>>8)-0x21,trail=(row&1?0x5e:0)+(common&255)-0x21,lead=row>>1;
  return (lead<0x1f?lead+0x81:lead+0xc1)*256+(trail<0x3f?trail+0x40:trail+0x41);
}

/** CPython 3.14.7 Shift-JIS, using its independent directional JIS tables.
 * Single-byte kana and invalid leads are resolved before requesting a trail.
 * Recovery and pending input belong to the shared multibyte engines; native
 * opaque state is preserved unchanged. No host encoding service is consulted. */
export const shiftJisCodec=new DoubleByteCodec("shift_jis",lookupPair,lookupCharacter,undefined,undefined,{
  read(input,position,_state,meter){
    meter.checkpoint(1,32);
    const first=input[position];
    if(first<0x80)return {width:1,points:[first]};
    if(first>=0xa1&&first<=0xdf)return {width:1,points:[first+0xfec0]};
    if(!(first>=0x81&&first<=0x9f||first>=0xe0&&first<=0xea))return "invalid";
    if(position+2>input.length)return "incomplete";
    const point=lookupPair(first,input[position+1],meter);
    return point===undefined?"invalid":{width:2,points:[point]};
  },
  write(point,_state,meter){
    const encoded=lookupCharacter(point,meter);
    if(encoded===undefined)return undefined;
    meter.checkpoint(0,encoded<256?40:48);
    return encoded<256?[encoded]:[encoded>>8,encoded&255];
  },
  reset(_state,meter){meter.checkpoint();return [];}
});
