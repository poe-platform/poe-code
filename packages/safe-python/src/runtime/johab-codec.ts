import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupCp949Character,lookupCp949Pair} from "./cp949-mapping.js";
import type {ExecutionMeter} from "./execution-budget.js";

// CPython 3.14.7 Modules/cjkcodecs/_codecs_kr.c. Johab's syllable fields
// have holes and filler values; compatibility jamo use canonical initial
// spellings where a character also has a terminal spelling.
const medial=[3,4,5,6,7,10,11,12,13,14,15,18,19,20,21,22,23,26,27,28,29];
const terminal=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,19,20,21,22,23,24,25,26,27,28,29];
const initialJamo=[0x31,0x32,0x34,0x37,0x38,0x39,0x41,0x42,0x43,0x45,0x46,0x47,0x48,0x49,0x4a,0x4b,0x4c,0x4d,0x4e];
const terminalJamo=[0,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x39,0x3a,0x3b,0x3c,0x3d,0x3e,0x3f,0x40,0x41,0x42,0x44,0x45,0x46,0x47,0x48,0x4a,0x4b,0x4c,0x4d,0x4e];

function decodePair(first:number,second:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(first<0xd8){
    const cho=(first>>2)&31,jung=((first<<3)|(second>>5))&31,jong=second&31;
    meter.checkpoint(medial.length+terminal.length);
    const vowel=medial.indexOf(jung),end=terminal.indexOf(jong);
    if(cho<1||cho>20||(jung!==2&&vowel<0)||end<0)return undefined;
    if(cho===1){
      if(jung===2)return end===0?0x3000:0x3100|terminalJamo[end];
      return end===0?0x314f+vowel:undefined;
    }
    if(jung===2)return end===0?0x3100|initialJamo[cho-2]:undefined;
    return 0xac00+(cho-2)*588+vowel*28+end;
  }
  if(first===0xdf||first>0xf9||second<0x31||(second>=0x80&&second<0x91)||
    (second&0x7f)===0x7f||(first===0xda&&second>=0xa1&&second<=0xd3))return undefined;
  const column=second<0x91?second-0x31:second-0x43;
  const row=(first<0xe0?2*(first-0xd9):2*first-0x197)+(column<0x5e?0:1)+0x21;
  if(row<0x21||row>0x7e)return undefined;
  return lookupCp949Pair(row+0x80,(column<0x5e?column:column-0x5e)+0xa1,meter);
}

function encodeCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<128)return point;
  if(point>0xffff)return undefined;
  if(point>=0xac00&&point<=0xd7a3){
    const syllable=point-0xac00;
    return 0x8000|((Math.floor(syllable/588)+2)<<10)|(medial[Math.floor(syllable/28)%21]<<5)|terminal[syllable%28];
  }
  if(point>=0x3131&&point<=0x3163){
    if(point>=0x314f)return 0x8401|(medial[point-0x314f]<<5);
    meter.checkpoint(initialJamo.length+terminalJamo.length);
    const initial=initialJamo.indexOf(point-0x3100);
    return initial>=0?0x8041|((initial+2)<<10):0x8440|terminal[terminalJamo.indexOf(point-0x3100)];
  }
  const encoded=lookupCp949Character(point,meter);
  if(encoded===undefined)return undefined;
  const first=(encoded>>8)-0x80,second=(encoded&255)-0x80;
  if(!((first>=0x21&&first<=0x2c)||(first>=0x4a&&first<=0x7d))||second<0x21||second>0x7e)return undefined;
  const row=first-0x21+(first<0x4a?0x1b2:0x197);
  const column=((row&1)?0x5e:0)+second-0x21;
  return ((row>>1)<<8)|(column<0x4e?column+0x31:column+0x43);
}

/** Stateless Johab uses the shared incremental and registered-recovery engine.
 * The pinned directional KS X 1001 mappings are reused from CP949; neither
 * Unicode normalization nor codec behavior is delegated to the host. */
export const johabCodec=new DoubleByteCodec("johab",decodePair,encodeCharacter);
