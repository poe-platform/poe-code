import {jisx0208_decmap,jisxcommon_encmap} from "./cp932-data.js";
import {jisx0213_1_bmp_decmap,jisx0213_2_bmp_decmap,jisx0213_1_emp_decmap,jisx0213_2_emp_decmap,jisx0213_bmp_encmap,jisx0213_emp_encmap,jisx0213_pair_decmap,jisx0213_pair_encmap} from "./jisx0213-data.js";
import {DoubleByteCodec} from "./double-byte-codec.js";
import {jisx0213AddedCharacters,jisx0213AddedCells} from "./jisx0213-2000.js";
import type {ExecutionMeter} from "./execution-budget.js";

function lookup(table:readonly number[],key:number,meter:ExecutionMeter):number|undefined {
  let low=0,high=table.length/2;
  while(low<high){
    meter.checkpoint();
    const middle=Math.floor((low+high)/2),candidate=table[middle*2];
    if(candidate===key)return table[middle*2+1];
    if(candidate<key)low=middle+1;else high=middle;
  }
  return undefined;
}

function shiftPair(code:number):number {
  let row=code>>8,column=(code&255)-0x21;
  if(row&0x80)row-=row>=0xee?0x87:row>=0xac||row===0xa8?0x49:0x43;
  else row-=0x21;
  if(row&1)column+=0x5e;
  row>>=1;
  return (row+(row<0x1f?0x81:0xc1))*256+column+(column<0x3f?0x40:0x41);
}

function createShiftJisCodec(name:"shift_jis_2004"|"shift_jisx0213",revision:2000|2004):DoubleByteCodec {
const addedPairs=jisx0213AddedCells.map(shiftPair);
function lookupPair(first:number,second:number,meter:ExecutionMeter):readonly number[]|undefined {
  if(!(first>=0x81&&first<=0x9f||first>=0xe0&&first<=0xfc)||second<0x40||second===0x7f||second>0xfc)return undefined;
  const trail=second<0x80?second-0x40:second-0x41;
  let row=2*(first<0xe0?first-0x81:first-0xc1)+(trail<0x5e?0:1);
  const column=(trail<0x5e?trail:trail-0x5e)+0x21,plane1=row<0x5e;
  row+=plane1?0x21:row>=0x67?0x07:row>=0x63||row===0x5f?-0x37:-0x3d;
  const key=row*256+column;
  if(revision===2000){
    if(plane1&&jisx0213AddedCells.includes(key))return undefined;
    if(!plane1&&key===0x7d3b){meter.checkpoint(0,40);return [0x9b1d];}
  }
  const bmp=(plane1?lookup(jisx0208_decmap,key,meter):undefined)
    ??lookup(plane1?jisx0213_1_bmp_decmap:jisx0213_2_bmp_decmap,key,meter);
  if(bmp!==undefined){meter.checkpoint(0,40);return [bmp];}
  const emp=lookup(plane1?jisx0213_1_emp_decmap:jisx0213_2_emp_decmap,key,meter);
  if(emp!==undefined){meter.checkpoint(0,40);return [0x20000+emp];}
  const pair=plane1?lookup(jisx0213_pair_decmap,key,meter):undefined;
  if(pair===undefined)return undefined;
  meter.checkpoint(0,48);return [pair>>>16,pair&0xffff];
}

function lookupCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<0x80&&point!==0x5c&&point!==0x7e)return point;
  if(point===0xa5)return 0x5c;
  if(point===0x203e)return 0x7e;
  if(point>=0xff61&&point<=0xff9f)return point-0xfec0;
  if(revision===2000){
    if(jisx0213AddedCharacters.includes(point))return undefined;
    if(point===0x9b1d)return shiftPair(0xfd3b);
  }
  let code:number|undefined;
  if(point<=0xffff){
    code=lookup(jisx0213_bmp_encmap,point,meter);
    if(code===-2)code=lookup(jisx0213_pair_encmap,point*65536,meter);
    else if(code===undefined){
      code=lookup(jisxcommon_encmap,point,meter);
      if(code!==undefined&&(code&0x8000))return undefined;
    }
  }else if(point>>>16===2)code=lookup(jisx0213_emp_encmap,point&0xffff,meter);
  return code===undefined?undefined:shiftPair(code);
}

/** CPython 3.14.7 JIS X 0213:2004 directional tables, Roman singles and
 * two-character mappings. No normalization or ambient host codec is involved. */
return new DoubleByteCodec(name,lookupPair,lookupCharacter,undefined,{
  prefixes:Object.freeze(jisx0213_bmp_encmap.filter((_,i)=>i%2===0&&jisx0213_bmp_encmap[i+1]===-2)),
  lookup(first,second,meter){
    // The native pair helper takes a 16-bit modifier, even for supplementary
    // input. Consumption tests the original character: literal NUL remains,
    // whereas a supplementary character with low bits zero is consumed.
    if(second===0)return undefined;
    const code=lookup(jisx0213_pair_encmap,first*65536+(second&0xffff),meter);
    return code===undefined?undefined:shiftPair(code);
  }
},{
  read(input,position,_state,meter){
    meter.checkpoint(1,32);
    const first=input[position];
    if(first<0x80)return {width:1,points:[first===0x5c?0xa5:first===0x7e?0x203e:first]};
    if(first>=0xa1&&first<=0xdf)return {width:1,points:[first+0xfec0]};
    if(!(first>=0x81&&first<=0x9f||first>=0xe0&&first<=0xfc))return "invalid";
    if(position+2>input.length)return "incomplete";
    if(revision===2000&&addedPairs.includes(first*256+input[position+1]))return {errorWidth:2};
    const points=lookupPair(first,input[position+1],meter);
    return points===undefined?"invalid":{width:2,points};
  },
  write(point,_state,meter){
    const code=lookupCharacter(point,meter);
    if(code===undefined)return undefined;
    meter.checkpoint(0,code<256?40:48);
    return code<256?[code]:[code>>8,code&255];
  },
  reset(_state,meter){meter.checkpoint();return [];}
});
}

export const shiftJis2004Codec=createShiftJisCodec("shift_jis_2004",2004);
export const shiftJisX0213Codec=createShiftJisCodec("shift_jisx0213",2000);
