import {gb2312Decode,gb2312Encode} from "./gb2312-data.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** A complete GB2312 double-byte mapping. ASCII and incomplete/illegal sequence
 * handling belong to the codec state machine, not the mapping table. */
export function lookupGb2312Pair(first:number,second:number,meter?:ExecutionMeter):number|undefined {
  meter?.checkpoint();
  if(first<0xa1||first>0xfe||second<0xa1||second>0xfe)return undefined;
  const point=gb2312Decode[(first-0xa1)*94+second-0xa1];
  return point===-1?undefined:point;
}

/** Return an ASCII byte or packed GB2312 pair. The independently pinned encoder
 * table preserves CPython's preferred mappings without assuming bijectivity. */
export function lookupGb2312Character(point:number,meter?:ExecutionMeter):number|undefined {
  meter?.checkpoint();
  if(point<128)return point;
  if(point>0xffff)return undefined;
  let low=0,high=gb2312Encode.length/2;
  while(low<high){
    meter?.checkpoint();
    const middle=Math.floor((low+high)/2),candidate=gb2312Encode[middle*2];
    if(candidate===point)return gb2312Encode[middle*2+1];
    if(candidate<point)low=middle+1;
    else high=middle;
  }
  return undefined;
}
