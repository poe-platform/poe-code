import {hkscsDecode,hkscsEncode,hkscsExpansions} from "./hkscs-data.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** A pair can decode to two code points. Never coerce those mappings into a
 * scalar codec or reconstruct encoder choices by inverting decoder data. */
export function lookupHkscsPair(first:number,second:number,meter:ExecutionMeter):readonly number[]|undefined {
  meter.checkpoint();
  if(first<128||first>255||second<0||second>255)return undefined;
  const point=hkscsDecode[(first-128)*256+second];
  if(point!==-1){meter.checkpoint(0,40);return Object.freeze([point]);}
  const pair=first*256+second;
  for(let index=0;index<hkscsExpansions.length;index+=3){
    meter.checkpoint();
    if(hkscsExpansions[index]===pair){meter.checkpoint(0,48);return Object.freeze([hkscsExpansions[index+1],hkscsExpansions[index+2]]);}
  }
  return undefined;
}

/** Final singleton encoding; incremental prefix buffering belongs to the
 * sequence-aware encoder, which must consult lookupHkscsSequence first. */
export function lookupHkscsCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<128)return point;
  if(point>=0x30000||point>=0x10000&&point<0x20000)return undefined;
  let low=0,high=hkscsEncode.length/2;
  while(low<high){
    meter.checkpoint();
    const middle=Math.floor((low+high)/2),candidate=hkscsEncode[middle*2];
    if(candidate===point)return hkscsEncode[middle*2+1];
    if(candidate<point)low=middle+1;
    else high=middle;
  }
  return undefined;
}

export function lookupHkscsSequence(first:number,second:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  for(let index=0;index<hkscsExpansions.length;index+=3){
    meter.checkpoint();
    if(hkscsExpansions[index+1]===first&&hkscsExpansions[index+2]===second)return hkscsExpansions[index];
  }
  return undefined;
}
