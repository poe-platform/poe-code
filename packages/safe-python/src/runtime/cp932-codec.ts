import {cp932ext_decmap,cp932ext_encmap,jisx0208_decmap,jisxcommon_encmap} from "./cp932-data.js";
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
  const extension=lookup(cp932ext_decmap,first*256+second,meter);
  if(extension!==undefined)return extension;
  if(second<0x40||second===0x7f||second>0xfc)return undefined;
  const trail=second<0x80?second-0x40:second-0x41;
  if(first>=0x81&&first<=0x9f||first>=0xe0&&first<=0xea){
    const row=2*(first<0xe0?first-0x81:first-0xc1)+(trail<0x5e?0:1)+0x21;
    const column=(trail<0x5e?trail:trail-0x5e)+0x21;
    return lookup(jisx0208_decmap,row*256+column,meter);
  }
  if(first>=0xf0&&first<=0xf9)return 0xe000+188*(first-0xf0)+trail;
  return undefined;
}

function lookupCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<=0x80)return point;
  if(point>=0xff61&&point<=0xff9f)return point-0xfec0;
  if(point>=0xf8f0&&point<=0xf8f3)return point===0xf8f0?0xa0:point-0xf8f1+0xfd;
  if(point>0xffff)return undefined;
  const extension=lookup(cp932ext_encmap,point,meter);
  if(extension!==undefined)return extension;
  const common=lookup(jisxcommon_encmap,point,meter);
  if(common!==undefined){
    if(common&0x8000)return undefined;
    const row=(common>>8)-0x21,trail=(row&1?0x5e:0)+(common&255)-0x21,lead=row>>1;
    return (lead<0x1f?lead+0x81:lead+0xc1)*256+(trail<0x3f?trail+0x40:trail+0x41);
  }
  if(point>=0xe000&&point<0xe758){
    const offset=point-0xe000,trail=offset%188;
    return (Math.floor(offset/188)+0xf0)*256+(trail<0x3f?trail+0x40:trail+0x41);
  }
  return undefined;
}

/** CPython 3.14.7 CP932 machine: independent directional JIS/Windows tables,
 * native single-byte extensions and user-defined area. The shared engine owns
 * errors and pending input; the eight opaque state bytes remain unchanged. */
export const cp932Codec=new DoubleByteCodec("cp932",lookupPair,lookupCharacter,undefined,undefined,{
  read(input,position,_state,meter){
    meter.checkpoint(1,32);
    const first=input[position];
    if(first<=0x80)return {width:1,points:[first]};
    if(first>=0xa0&&first<=0xdf)return {width:1,points:[first===0xa0?0xf8f0:0xfec0+first]};
    if(first>=0xfd)return {width:1,points:[0xf8f1+first-0xfd]};
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
