import {gb18030ExtensionDecode,gb18030ExtensionEncode,gb18030BmpRanges} from "./gb18030-data.js";
import {lookupGbkCharacter,lookupGbkPair} from "./gbk-mapping.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** GBK precedes the independent GB18030 extension in both native directions. */
export function lookupGb18030Pair(first:number,second:number,meter:ExecutionMeter):number|undefined {
  const gbk=lookupGbkPair(first,second,meter);
  if(gbk!==undefined)return gbk;
  if(first<0x81||first>0xfe||second<0x40||second>0xfe)return undefined;
  const point=gb18030ExtensionDecode[(first-128)*256+second];
  return point===-1?undefined:point;
}

/** Four-byte indices cover a BMP prefix and a disjoint supplementary range.
 * The gap and the tail of the syntactic index space are not Unicode mappings. */
export function lookupGb18030Quad(first:number,second:number,third:number,fourth:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(first<0x81||first>0xfe||second<0x30||second>0x39||third<0x81||third>0xfe||fourth<0x30||fourth>0x39)return undefined;
  const index=((first-0x81)*10+second-0x30)*1260+(third-0x81)*10+fourth-0x30;
  if(index>=189000)return index<189000+0x100000?index-189000+0x10000:undefined;
  let low=0,high=gb18030BmpRanges.length/3;
  while(low<high){
    meter.checkpoint();
    const middle=Math.floor((low+high)/2),first=gb18030BmpRanges[middle*3],last=gb18030BmpRanges[middle*3+1],base=gb18030BmpRanges[middle*3+2];
    if(index<base)high=middle;
    else if(index>base+last-first)low=middle+1;
    else return first+index-base;
  }
  return undefined;
}

/** ASCII byte, packed two-byte or unsigned packed four-byte encoding. The
 * returned number is exact in JS; no signed bitwise packing of four bytes. */
export function lookupGb18030Character(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  let index:number|undefined;
  if(point>=0x10000){
    if(point>0x10ffff)return undefined;
    index=point-0x10000+189000;
  }else{
    const gbk=lookupGbkCharacter(point,meter);
    if(gbk!==undefined)return gbk;
    let low=0,high=gb18030ExtensionEncode.length/2;
    while(low<high){
      meter.checkpoint();
      const middle=Math.floor((low+high)/2),candidate=gb18030ExtensionEncode[middle*2];
      if(candidate===point)return gb18030ExtensionEncode[middle*2+1];
      if(candidate<point)low=middle+1;
      else high=middle;
    }
    low=0;high=gb18030BmpRanges.length/3;
    while(low<high){
      meter.checkpoint();
      const middle=Math.floor((low+high)/2),first=gb18030BmpRanges[middle*3],last=gb18030BmpRanges[middle*3+1];
      if(point<first)high=middle;
      else if(point>last)low=middle+1;
      else {index=point-first+gb18030BmpRanges[middle*3+2];break;}
    }
    if(index===undefined)return undefined;
  }
  const fourth=index%10+0x30;index=Math.floor(index/10);
  const third=index%126+0x81;index=Math.floor(index/126);
  const second=index%10+0x30,first=Math.floor(index/10)+0x81;
  return ((first*256+second)*256+third)*256+fourth;
}
