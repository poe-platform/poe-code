import {jisx0208_decmap,jisxcommon_encmap} from "./cp932-data.js";
import {DoubleByteCodec,type MultibyteCodecState} from "./double-byte-codec.js";
import type {ExecutionMeter} from "./execution-budget.js";

// State transitions follow CPython 3.14.7 Modules/cjkcodecs/_codecs_iso2022.c.
// Copyright Python Software Foundation; see CPYTHON-LICENSE.txt.
// CPython's pinned little-endian state: G0/G1/G2/G3, then shift/escape flags.
const shifted=1n<<32n,throughout=2n<<32n;

interface AdditionalDesignation {
  readonly mark:number;
  readonly width:1|2;
  readonly decode?:(first:number,second:number,meter:ExecutionMeter)=>number|readonly number[]|undefined;
  readonly encode?:(point:number,meter:ExecutionMeter)=>number|undefined;
}
interface JapaneseExtensions {
  readonly designations:readonly AdditionalDesignation[];
  readonly singleShift?:(byte:number,charset:number,meter:ExecutionMeter)=>number|undefined;
  readonly legacyDesignations?:boolean;
  readonly sequences?:NonNullable<DoubleByteCodec['sequences']>;
}

/** Emit a selected G0 mapping and retain the exact native designation state. */
export function writeIso2022Designation(encoded:number,charset:number,state:MultibyteCodecState,meter:ExecutionMeter):readonly number[] {
  meter.checkpoint(1,64);
  const output:number[]=[];
  if(state.value&shifted){output.push(15);state.value&=~shifted;}
  if((state.value&255n)!==BigInt(charset)){
    if((charset&128)&&charset!==194)output.push(27,36,40,charset&127);
    else output.push(27,charset&128?36:40,charset&127);
    state.value=(state.value&~255n)|BigInt(charset);
  }
  if(charset&128)output.push(encoded>>8);
  output.push(encoded&255);
  return output;
}

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

function lookupPair(first:number,second:number,meter:ExecutionMeter):number|undefined {
  // The reference's non-STRICT_BUILD chooses full-width reverse solidus.
  if(first===0x21&&second===0x40)return 0xff3c;
  return lookup(jisx0208_decmap,first*256+second,meter);
}

function lookupCharacter(point:number,meter:ExecutionMeter):number|undefined {
  meter.checkpoint();
  if(point<128)return point;
  if(point===0xff3c)return 0x2140;
  if(point>0xffff)return undefined;
  const common=lookup(jisxcommon_encmap,point,meter);
  return common===undefined||common&0x8000?undefined:common;
}

/** ISO-2022-JP variants, using pinned directional JIS tables and CPython's native
 * designation parser. SO/SI remain literal controls; Roman and both JIS 0208
 * designations are accepted in either G0 or G1. Supplying the JIS X 0212 table
 * enables JP-1 selection after JIS X 0208 and before Roman. JP-EXT additionally
 * supports JIS X 0201 kana in G0/G1, selected after Roman when encoding.
 * JP-2 supplies additional designations and the G2 single-shift operation.
 * The shared multibyte engines
 * own recovery, incremental pending input and operation-local output. */
export function createIso2022JpCodec(name:string,jis0212?:readonly number[],kana=false,extensions?:JapaneseExtensions):DoubleByteCodec {
return new DoubleByteCodec(name,lookupPair,lookupCharacter,undefined,extensions?.sequences,{
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
      if(second===78&&extensions?.singleShift!==undefined){
        if(position+2===input.length)return "incomplete";
        const point=extensions.singleShift(input[position+2],Number((state.value>>16n)&255n),meter);
        return point===undefined?{errorWidth:3}:{width:3,points:[point]};
      }
      if(second!==40&&second!==41&&second!==36&&second!==46&&second!==38){
        state.value|=throughout;
        return {width:1,points:[27]};
      }
      let width=0;
      for(let index=1;index<16;index++){
        meter.checkpoint();
        if(position+index>=input.length)return "incomplete";
        const byte=input[position+index];
        if(byte>=65&&byte<=90||byte===64){width=index+1;break;}
        if(byte===38&&position+index+1<input.length&&input[position+index+1]===64)index+=2;
      }
      if(width===0)return "invalid";
      let charset:number,designation:number;
      if(width===3){
        if(second===36){charset=input[position+2]|128;designation=0;}
        else{
          charset=input[position+2];
          if(second===40)designation=0;
          else if(second===41)designation=1;
          else if(second===46&&extensions?.singleShift!==undefined)designation=2;
          else return {errorWidth:width};
        }
      }else if(width===4&&second===36){
        charset=input[position+3]|128;
        const third=input[position+2];
        if(third===40)designation=0;
        else if(third===41)designation=1;
        else return {errorWidth:width};
      }else if(width===6&&input[position+3]===27&&input[position+4]===36&&input[position+5]===66){
        charset=194;designation=0;
      }else return {errorWidth:width};
      const legacy=extensions?.legacyDesignations!==false;
      if(charset!==66&&!(legacy&&(charset===74||charset===192))&&charset!==194&&!(charset===196&&jis0212!==undefined)&&!(charset===73&&kana)&&!extensions?.designations.some(entry=>entry.mark===charset))return {errorWidth:width};
      const offset=BigInt(designation*8);
      state.value=(state.value&~(255n<<offset))|(BigInt(charset)<<offset);
      return {width,points:[]};
    }
    if(first===10)state.value&=~shifted;
    if(first<32)return {width:1,points:[first]};
    if(first>=128)return "invalid";
    const charset=Number((state.value>>(state.value&shifted?8n:0n))&255n);
    if(charset===66)return {width:1,points:[first]};
    if(charset===74)return {width:1,points:[first===92?0xa5:first===126?0x203e:first]};
    if(charset===73&&kana)return first>=0x21&&first<=0x5f?{width:1,points:[first+0xff40]}:"invalid";
    const additional=extensions?.designations.find(entry=>entry.mark===charset);
    if(additional!==undefined){
      if(position+additional.width>input.length)return "incomplete";
      const point=additional.decode?.(first,input[position+1],meter);
      return point===undefined?{errorWidth:additional.width}:{width:additional.width,points:typeof point==='number'?[point]:point};
    }
    if(charset!==192&&charset!==194&&!(charset===196&&jis0212!==undefined))throw Error("invalid ISO-2022-JP native character set state");
    if(position+1===input.length)return "incomplete";
    const point=charset===196?lookup(jis0212!,first*256+input[position+1],meter):lookupPair(first,input[position+1],meter);
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
    let encoded=lookupCharacter(point,meter),charset=194;
    if(encoded===undefined&&jis0212!==undefined&&point<=0xffff){
      const common=lookup(jisxcommon_encmap,point,meter);
      if(common!==undefined&&(common&0x8000)){encoded=common&0x7fff;charset=196;}
    }
    if(encoded===undefined&&extensions!==undefined){
      for(const designation of extensions.designations){
        meter.checkpoint();
        encoded=designation.encode?.(point,meter);
        if(encoded!==undefined){charset=designation.mark;break;}
      }
    }
    if(encoded===undefined){
      if(extensions?.legacyDesignations===false)return undefined;
      charset=74;
      if(point===0xa5)encoded=92;
      else if(point===0x203e)encoded=126;
      else if(kana&&point>=0xff61&&point<=0xff9f){encoded=point-0xff40;charset=73;}
      else return undefined;
    }
    return writeIso2022Designation(encoded,charset,state,meter);
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
}

export const iso2022JpCodec=createIso2022JpCodec("iso2022_jp");
