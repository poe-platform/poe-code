import {jisx0208_decmap,jisxcommon_encmap} from './cp932-data.js';
import {jisx0213_1_bmp_decmap,jisx0213_2_bmp_decmap,jisx0213_1_emp_decmap,jisx0213_2_emp_decmap,jisx0213_bmp_encmap,jisx0213_emp_encmap,jisx0213_pair_decmap,jisx0213_pair_encmap} from './jisx0213-data.js';
import {jisx0213AddedCharacters,jisx0213AddedCells} from './jisx0213-2000.js';
import {createIso2022JpCodec,writeIso2022Designation} from './iso2022-jp-codec.js';
import type {ExecutionMeter} from './execution-budget.js';

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

/** CPython 3.14.7 ISO-2022 JIS X 0213 designations. Pair mappings precede
 * JIS 0208; singleton mappings prefer JIS 0208. Roman and old JIS 0208
 * designations are absent from both revision registries. Directional maps
 * and the 2000 revision exclusions come from pinned package-owned data. */
function createRevisionCodec(name:string,revision:2000|2004){
  const planeOneMark=revision===2000?207:209;
  function character(point:number,meter:ExecutionMeter):number|undefined {
    meter.checkpoint();
    if(revision===2000){
      if(jisx0213AddedCharacters.includes(point))return undefined;
      if(point===0x9b1d)return 0xfd3b;
    }
    if(point>0xffff)return point>>>16===2?lookup(jisx0213_emp_encmap,point&0xffff,meter):undefined;
    let code=lookup(jisx0213_bmp_encmap,point,meter);
    if(code===-2)return lookup(jisx0213_pair_encmap,point*65536,meter);
    if(code===undefined){
      code=lookup(jisxcommon_encmap,point,meter);
      if(code!==undefined&&(code&0x8000))return undefined;
    }
    return code;
  }
  return createIso2022JpCodec(name,undefined,false,{
    legacyDesignations:false,
    sequences:{
      prefixes:Object.freeze(jisx0213_bmp_encmap.filter((_,index)=>index%2===0&&jisx0213_bmp_encmap[index+1]===-2)),
      lookup(first,second,meter){
        if(second===0)return undefined;
        return lookup(jisx0213_pair_encmap,first*65536+(second&0xffff),meter);
      },
      write(encoded,state,meter){return writeIso2022Designation(encoded,planeOneMark,state,meter);}
    },
    designations:[{
      mark:planeOneMark,width:2,
      encode(point,meter){const code=character(point,meter);return code===undefined||code&0x8000?undefined:code;},
      decode(first,second,meter){
        const key=first*256+second;
        if(revision===2000&&jisx0213AddedCells.includes(key))return undefined;
        if(key===0x2140)return 0xff3c;
        const bmp=lookup(jisx0208_decmap,key,meter)??lookup(jisx0213_1_bmp_decmap,key,meter);
        if(bmp!==undefined)return bmp;
        const emp=lookup(jisx0213_1_emp_decmap,key,meter);
        if(emp!==undefined)return 0x20000+emp;
        const pair=lookup(jisx0213_pair_decmap,key,meter);
        if(pair===undefined)return undefined;
        meter.checkpoint(0,48);
        return [pair>>>16,pair&0xffff];
      }
    },{
      mark:208,width:2,
      encode(point,meter){const code=character(point,meter);return code!==undefined&&(code&0x8000)?code&0x7fff:undefined;},
      decode(first,second,meter){
        const key=first*256+second;
        // The reference's plane-two emulation assignment is overwritten by
        // the following table lookup: JP-3 decodes 7d3b as U+9B1C too.
        const bmp=lookup(jisx0213_2_bmp_decmap,key,meter);
        if(bmp!==undefined)return bmp;
        const emp=lookup(jisx0213_2_emp_decmap,key,meter);
        return emp===undefined?undefined:0x20000+emp;
      }
    }]
  });
}

export const iso2022Jp3Codec=createRevisionCodec('iso2022_jp_3',2000);
export const iso2022Jp2004Codec=createRevisionCodec('iso2022_jp_2004',2004);
