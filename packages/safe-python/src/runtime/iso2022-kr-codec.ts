import {DoubleByteCodec} from "./double-byte-codec.js";
import {lookupCp949Character,lookupCp949Pair} from "./cp949-mapping.js";

// CPython's little-endian native state: G0/G1/G2/G3, then shift/escape flags.
const shifted=1n<<32n,throughout=2n<<32n;

/** ISO-2022-KR's KS X 1001 designations and locked shifts, over pinned directional
 * Korean tables. C0 controls, escape passthrough and designation-error lengths
 * are native codec behavior, independent of host encodings or Unicode data. */
export const iso2022KrCodec=new DoubleByteCodec("iso2022_kr",lookupCp949Pair,lookupCp949Character,undefined,undefined,{
  encoderInitialState:0x4242n,
  decoderInitialState:0x424242n,
  read(input,position,state,meter){
    meter.checkpoint(1,32);
    const first=input[position];
    if(state.value&throughout){
      if(first>=65&&first<=90||first===64)state.value&=~throughout;
      return {width:1,points:[first]};
    }
    if(first===27){
      if(position+1===input.length)return "incomplete";
      const second=input[position+1];
      if(second!==40&&second!==41&&second!==36&&second!==46&&second!==38){
        state.value|=throughout;
        return {width:1,points:[27]};
      }
      let width=0;
      for(let index=1;index<16;index++){
        meter.checkpoint();
        if(position+index===input.length)return "incomplete";
        const byte=input[position+index];
        if(byte>=65&&byte<=90||byte===64){width=index+1;break;}
      }
      if(width===0)return "invalid";
      let charset:number,designation:number;
      if(width===3){
        if(second===36){charset=input[position+2]|128;designation=0;}
        else{
          charset=input[position+2];
          if(second===40)designation=0;
          else if(second===41)designation=1;
          else return {errorWidth:width};
        }
      }else if(width===4&&second===36){
        charset=input[position+3]|128;
        const third=input[position+2];
        if(third===40)designation=0;
        else if(third===41)designation=1;
        else return {errorWidth:width};
      }else return {errorWidth:width};
      if(charset!==66&&charset!==195)return {errorWidth:width};
      const offset=BigInt(designation*8);
      state.value=(state.value&~(255n<<offset))|(BigInt(charset)<<offset);
      return {width,points:[]};
    }
    if(first===15){state.value&=~shifted;return {width:1,points:[]};}
    if(first===14){state.value|=shifted;return {width:1,points:[]};}
    if(first===10){state.value&=~shifted;return {width:1,points:[10]};}
    if(first<32)return {width:1,points:[first]};
    if(first>=128)return "invalid";
    const charset=Number((state.value>>(state.value&shifted?8n:0n))&255n);
    if(charset===66)return {width:1,points:[first]};
    // Only ASCII and KS X 1001 can be designated by this codec.
    if(charset!==195)throw Error("invalid ISO-2022-KR native character set state");
    if(position+1===input.length)return "incomplete";
    const second=input[position+1];
    const point=first>=33&&first<=126&&second>=33&&second<=126?lookupCp949Pair(first+128,second+128,meter):undefined;
    return point===undefined?{errorWidth:2}:{width:2,points:[point]};
  },
  write(point,state,meter){
    meter.checkpoint(1,96);
    const output:number[]=[];
    if(point<128){
      if((state.value&255n)!==66n){output.push(27,40,66);state.value=(state.value&~255n)|66n;}
      if(state.value&shifted){output.push(15);state.value&=~shifted;}
      output.push(point);return output;
    }
    const encoded=lookupCp949Character(point,meter);
    if(encoded===undefined||(encoded>>8)<161||(encoded&255)<161)return undefined;
    if(((state.value>>8n)&255n)!==195n){output.push(27,36,41,67);state.value=(state.value&~0xff00n)|0xc300n;}
    if(!(state.value&shifted)){output.push(14);state.value|=shifted;}
    output.push((encoded>>8)-128,(encoded&255)-128);
    return output;
  },
  reset(state,meter){
    meter.checkpoint(1,64);
    const output:number[]=[];
    if(state.value&shifted){output.push(15);state.value&=~shifted;}
    if((state.value&255n)!==66n){output.push(27,40,66);state.value=(state.value&~255n)|66n;}
    return output;
  },
  resetDecoder(state,meter){
    meter.checkpoint();
    state.value=(state.value&~(255n|shifted))|66n;
  }
});
