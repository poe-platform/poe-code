import {cp949Decode,cp949Encode} from "./cp949-data.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** Pinned CP949 mappings. The shared multibyte engine handles ASCII and
 * incomplete tails; holes in the native tables remain unmappable. */
export function lookupCp949Pair(first:number,second:number,meter?:ExecutionMeter):number|undefined {
  meter?.checkpoint();
  if(first<128||first>255||second<0||second>255)return undefined;
  const point=cp949Decode[(first-128)*256+second];
  return point===-1?undefined:point;
}

export function lookupCp949Character(point:number,meter?:ExecutionMeter):number|undefined {
  meter?.checkpoint();
  if(point<128)return point;
  if(point>0xffff)return undefined;
  let low=0,high=cp949Encode.length/2;
  while(low<high){
    meter?.checkpoint();
    const middle=Math.floor((low+high)/2),candidate=cp949Encode[middle*2];
    if(candidate===point)return cp949Encode[middle*2+1];
    if(candidate<point)low=middle+1;
    else high=middle;
  }
  return undefined;
}
