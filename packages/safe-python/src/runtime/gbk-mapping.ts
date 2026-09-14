import {gbkDecode,gbkEncode} from "./gbk-data.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** Pinned GBK double-byte mapping; ASCII and incomplete-sequence handling
 * belong to the multibyte state machine. Undefined entries stay undefined. */
export function lookupGbkPair(first:number,second:number,meter?:ExecutionMeter):number|undefined {
  meter?.checkpoint();
  if(first<0x81||first>0xfe||second<0x40||second>0xfe)return undefined;
  const point=gbkDecode[(first-128)*256+second];
  return point===-1?undefined:point;
}

/** Return an ASCII byte or packed GBK pair using the native encoder's map. */
export function lookupGbkCharacter(point:number,meter?:ExecutionMeter):number|undefined {
  meter?.checkpoint();
  if(point<128)return point;
  if(point>0xffff)return undefined;
  let low=0,high=gbkEncode.length/2;
  while(low<high){
    meter?.checkpoint();
    const middle=Math.floor((low+high)/2),candidate=gbkEncode[middle*2];
    if(candidate===point)return gbkEncode[middle*2+1];
    if(candidate<point)low=middle+1;
    else high=middle;
  }
  return undefined;
}
