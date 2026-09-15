import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupGb2312Character,lookupGb2312Pair} from "./gb2312-mapping.js";

/** CPython 3.14.7 _codecs_cn.c: HZ uses GB2312's directional tables and
 * the low native state byte. Noncanonical injected mode bytes are observable:
 * any nonzero byte selects GB pairs, but only mode 1 accepts the ASCII escape.
 * No Unicode mappings or platform byte order are obtained from the host. */
export const hzCodec=new DoubleByteCodec("hz",lookupGb2312Pair,lookupGb2312Character,undefined,undefined,{
  read(input,position,state,meter){
    meter.checkpoint(1,32);
    const first=input[position],mode=Number(state.value&255n);
    if(first===126){
      if(position+1===input.length)return "incomplete";
      const second=input[position+1];
      if(second===126&&mode===0)return {width:2,points:[126]};
      if(second===123&&mode===0)state.value=(state.value&~255n)|1n;
      else if(second===10&&mode===0){ /* ASCII line continuation. */ }
      else if(second===125&&mode===1)state.value&=~255n;
      else return "invalid";
      return {width:2,points:[]};
    }
    if(first>=128)return "invalid";
    if(mode===0)return {width:1,points:[first]};
    if(position+1===input.length)return "incomplete";
    const point=lookupGb2312Pair(first+128,input[position+1]+128,meter);
    return point===undefined?"invalid":{width:2,points:[point]};
  },
  write(point,state,meter){
    meter.checkpoint(1,32);
    const mode=Number(state.value&255n);
    if(point<128){
      const output=mode===0?[]:[126,125];
      state.value&=~255n;
      output.push(point);
      if(point===126)output.push(126);
      return output;
    }
    const encoded=lookupGb2312Character(point,meter);
    if(encoded===undefined)return undefined;
    const output=mode===0?[126,123]:[];
    if(mode===0)state.value=(state.value&~255n)|1n;
    output.push((encoded>>8)-128,(encoded&255)-128);
    return output;
  },
  reset(state,meter){
    meter.checkpoint(1,16);
    const output=(state.value&255n)===0n?[]:[126,125];
    state.value&=~255n;
    return output;
  }
});
