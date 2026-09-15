import {jisx0208_decmap,jisxcommon_encmap} from "./cp932-data.js";
import {jisx0212_decmap} from "./euc-jp-data.js";
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

function createEucJisCodec(name:"euc_jis_2004"|"euc_jisx0213",revision:2000|2004):DoubleByteCodec {
function lookupPair(first:number,second:number,meter:ExecutionMeter):readonly number[]|undefined {
  let point:number|undefined;
  if(first===0x8e)point=second>=0xa1&&second<=0xdf?second+0xfec0:undefined;
  else{
    const key=(first^0x80)*256+(second^0x80);
    if(revision===2000&&jisx0213AddedCells.includes(key))return undefined;
    // The pinned non-STRICT_BUILD keeps the full-width compatibility forms.
    point=key===0x2140?0xff3c:key===0x2232?0xff5e:
      lookup(jisx0208_decmap,key,meter)??lookup(jisx0213_1_bmp_decmap,key,meter);
    if(point===undefined){
      const emp=lookup(jisx0213_1_emp_decmap,key,meter);
      if(emp!==undefined)point=0x20000+emp;
      else{
        const pair=lookup(jisx0213_pair_decmap,key,meter);
        if(pair!==undefined){meter.checkpoint(0,48);return [pair>>>16,pair&0xffff];}
      }
    }
  }
  if(point===undefined)return undefined;
  meter.checkpoint(0,40);return [point];
}

function eucCode(code:number):number {
  return code&0x8000?0x8f0000+code+0x80:code|0x8080;
}

function lookupCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<0x80)return point;
  if(revision===2000){
    if(jisx0213AddedCharacters.includes(point))return undefined;
    if(point===0x9b1d)return eucCode(0xfd3b);
  }
  let code:number|undefined;
  if(point<=0xffff){
    code=lookup(jisx0213_bmp_encmap,point,meter);
    if(code===-2)code=lookup(jisx0213_pair_encmap,point*65536,meter);
    else if(code===undefined){
      code=lookup(jisxcommon_encmap,point,meter);
      if(code===undefined){
        if(point>=0xff61&&point<=0xff9f)return 0x8e00+point-0xfec0;
        if(point===0xff3c)code=0x2140;
        else if(point===0xff5e)code=0x2232;
      }
    }
  }else if(point>>>16===2)code=lookup(jisx0213_emp_encmap,point&0xffff,meter);
  return code===undefined?undefined:eucCode(code);
}

/** CPython 3.14.7 EUC-JIS-2004 directional maps, including JIS X 0212
 * fallback, supplementary points and two-character JIS X 0213 sequences.
 * State and registered recovery remain owned by the shared native engines. */
return new DoubleByteCodec(name,lookupPair,lookupCharacter,undefined,{
  prefixes:Object.freeze(jisx0213_bmp_encmap.filter((_,i)=>i%2===0&&jisx0213_bmp_encmap[i+1]===-2)),
  lookup(first,second,meter){
    // Native pair lookup narrows the modifier to 16 bits, but tests the
    // original character before consuming it (literal NUL is not consumed).
    if(second===0)return undefined;
    const code=lookup(jisx0213_pair_encmap,first*65536+(second&0xffff),meter);
    return code===undefined?undefined:eucCode(code);
  }
},{
  read(input,position,_state,meter){
    meter.checkpoint(1,32);
    const first=input[position];
    if(first<0x80)return {width:1,points:[first]};
    const width=first===0x8f?3:2;
    if(position+width>input.length)return "incomplete";
    if(width===2){
      if(revision===2000&&first!==0x8e&&jisx0213AddedCells.includes((first^0x80)*256+(input[position+1]^0x80)))return {errorWidth:2};
      const points=lookupPair(first,input[position+1],meter);
      return points===undefined?"invalid":{width,points};
    }
    const key=(input[position+1]^0x80)*256+(input[position+2]^0x80);
    let point=revision===2000&&key===0x7d3b?0x9b1d:lookup(jisx0213_2_bmp_decmap,key,meter);
    if(point===undefined){
      const emp=lookup(jisx0213_2_emp_decmap,key,meter);
      point=emp===undefined?lookup(jisx0212_decmap,key,meter):0x20000+emp;
    }
    if(point===undefined)return "invalid";
    meter.checkpoint(0,40);return {width,points:[point]};
  },
  write(point,_state,meter){
    const code=lookupCharacter(point,meter);
    if(code===undefined)return undefined;
    meter.checkpoint(0,code<256?40:code<65536?48:56);
    return code<256?[code]:code<65536?[code>>8,code&255]:[code>>16,(code>>8)&255,code&255];
  },
  reset(_state,meter){meter.checkpoint();return [];}
});
}

export const eucJis2004Codec=createEucJisCodec("euc_jis_2004",2004);
export const eucJisX0213Codec=createEucJisCodec("euc_jisx0213",2000);
