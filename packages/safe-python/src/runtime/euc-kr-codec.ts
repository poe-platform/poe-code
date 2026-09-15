import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupCp949Character,lookupCp949Pair} from "./cp949-mapping.js";

// CPython 3.14.7 _codecs_kr.c, KS X 1001:1998 composition spelling.
// The CP949 directional maps contain the KS X 1001 base and UHC extension;
// only the base is admitted as ordinary EUC-KR pairs. Extension syllables
// use the filler followed by initial, medial and final compatibility jamo.
const initial=[0xa1,0xa2,0xa4,0xa7,0xa8,0xa9,0xb1,0xb2,0xb3,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xbb,0xbc,0xbd,0xbe];
const terminal=[0xd4,0xa1,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa9,0xaa,0xab,0xac,0xad,0xae,0xaf,0xb0,0xb1,0xb2,0xb4,0xb5,0xb6,0xb7,0xb8,0xba,0xbb,0xbc,0xbd,0xbe];

/** Variable-width EUC-KR machine over the shared native multibyte engines.
 * Its eight opaque state bytes are preserved; composition is pending input,
 * not a shift mode. All Unicode mappings come from the pinned package data. */
export const eucKrCodec=new DoubleByteCodec("euc_kr",lookupCp949Pair,lookupCp949Character,undefined,undefined,{
  read(input,position,_state,meter){
    meter.checkpoint(1,32);
    const first=input[position];
    if(first<128)return {width:1,points:[first]};
    if(position+2>input.length)return "incomplete";
    const second=input[position+1];
    if(first===0xa4&&second===0xd4){
      // Native decoding waits for all eight bytes before validating any jamo.
      if(position+8>input.length)return "incomplete";
      if(input[position+2]!==0xa4||input[position+4]!==0xa4||input[position+6]!==0xa4)return "invalid";
      const cho=initial.indexOf(input[position+3]),jung=input[position+5]-0xbf,jong=terminal.indexOf(input[position+7]);
      if(cho<0||jung<0||jung>=21||jong<0)return "invalid";
      return {width:8,points:[0xac00+cho*588+jung*28+jong]};
    }
    if(first<0xa1||first>0xfe||second<0xa1||second>0xfe)return "invalid";
    const point=lookupCp949Pair(first,second,meter);
    return point===undefined?"invalid":{width:2,points:[point]};
  },
  write(point,_state,meter){
    meter.checkpoint();
    const encoded=lookupCp949Character(point,meter);
    if(encoded===undefined)return undefined;
    if(encoded<128){meter.checkpoint(0,40);return [encoded];}
    const first=encoded>>8,second=encoded&255;
    if(first>=0xa1&&second>=0xa1){meter.checkpoint(0,48);return [first,second];}
    meter.checkpoint(0,96);
    const syllable=point-0xac00;
    return [0xa4,0xd4,0xa4,initial[Math.floor(syllable/588)],0xa4,0xbf+Math.floor(syllable/28)%21,0xa4,terminal[syllable%28]];
  },
  reset(_state,meter){meter.checkpoint();return [];}
});
