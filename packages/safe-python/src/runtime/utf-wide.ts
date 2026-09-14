import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError,type DecodeErrorLocation} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {rejectEncodingReplacement} from "./reject-encoding-replacement.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";
import type {Utf8EncodeErrors} from "./utf8-encode.js";

export type UnicodeByteOrder=-1|0|1;
/** Registry adapters validate guest return types and normalize resume positions
 * before returning these internal recovery records. */
export type WideDecodeRecovery=(error:PythonDecodeError)=>{replacement:CodePointString;position:number;input:Uint8Array};
export type WideEncodeRecovery=(error:PythonEncodeError)=>{replacement:CodePointString|Uint8Array;position:number;failure?:unknown;rejectReplacement?:()=>never};
export interface WideUnicodeDecoded {
  readonly text:CodePointString;
  readonly consumed:number;
  readonly byteorder:UnicodeByteOrder;
}

/** Native order is pinned little-endian, independently of the JavaScript host.
 * Zero requests BOM detection; without a BOM it remains zero in the result.
 * This is the internal ex_decode kernel, not the BOM-requiring stream class. */
export function decodeWideUnicode(input:Uint8Array,width:16|32,byteorder:UnicodeByteOrder=0,errors:Utf8DecodeErrors|WideDecodeRecovery="strict",meter?:ExecutionMeter,final=true):WideUnicodeDecoded {
  const originalLength=input.length;
  const size=width/8,capacity=input.length*(errors==="backslashreplace"?4:1);
  // Scratch buffers retain metadata even when there are no input bytes.
  meter?.checkpoint(1,64+capacity*4);
  let output=new Uint32Array(capacity);
  let start=0,written=0,minimumMaximum=127;
  let initial:DecodeErrorLocation|undefined;
  const reserve=(count:number)=>{
    if(written+count<=output.length)return;
    // Growth owns a new array and a temporary view of the previous contents.
    const size=Math.max(written+count,output.length*2);meter?.checkpoint(written+1,128+size*4);
    const grown=new Uint32Array(size);grown.set(output.subarray(0,written));output=grown;
  };
  if(byteorder===0&&input.length>=size){
    const bom=readWord(input,0,size,true);
    if(bom===0xfeff){byteorder=-1;start=size;}
    else if(bom===(width===16?0xfffe:0xfffe0000)){byteorder=1;start=size;}
  }
  const little=byteorder!==1,encoding=`utf-${width}-${little?"le":"be"}`;
  while(start<input.length){
    meter?.checkpoint();
    reserve(16);
    let end=start+size,reason:string|undefined,point:number|undefined;
    if(end>input.length){
      if(!final)break;
      end=input.length;reason="truncated data";
    }else{
      point=readWord(input,start,size,little);
      if(width===32){
        if(point>0x10ffff)reason="code point not in range(0x110000)";
        else if(point>=0xd800&&point<=0xdfff)reason="code point in surrogate code point range(0xd800, 0xe000)";
      }else if(point>=0xdc00&&point<=0xdfff)reason="illegal encoding";
      else if(point>=0xd800&&point<=0xdbff){
        if(end+size>input.length){
          if(!final)break;
          end=input.length;reason="unexpected end of data";
        }else{
          const low=readWord(input,end,size,little);
          if(low<0xdc00||low>0xdfff)reason="illegal UTF-16 surrogate";
          else {point=0x10000+((point-0xd800)<<10)+low-0xdc00;end+=size;}
        }
      }
    }
    if(reason===undefined)output[written++]=point!;
    else if(errors==="surrogatepass"&&point!==undefined&&point>=0xd800&&point<=0xdfff){
      if(initial===undefined){meter?.checkpoint(0,48);initial={start,end,reason};}
      output[written++]=point;end=start+size;
    }else if(errors==="replace")output[written++]=0xfffd;
    else if(errors==="backslashreplace"){
      for(let index=start;index<end;index++){
        meter?.checkpoint();
        const byte=input[index];output[written++]=92;output[written++]=120;
        output[written++]="0123456789abcdef".charCodeAt(byte>>4);
        output[written++]="0123456789abcdef".charCodeAt(byte&15);
      }
    }else if(errors==="surrogateescape"&&input[start]>=128){
      if(initial===undefined){meter?.checkpoint(0,48);initial={start,end,reason};}
      // The handler consumes at most four non-ASCII bytes, then decoding resumes
      // at that byte position (which need not be aligned to a code unit).
      let resume=start;
      while(resume<end&&resume<start+4&&input[resume]>=128){meter?.checkpoint();output[written++]=0xdc00+input[resume++];}
      end=resume;
    }else if(typeof errors==="function"){
      const error=new PythonDecodeError(encoding,input,start,end,reason,meter);
      let fatal=false,recovery:ReturnType<WideDecodeRecovery>;
      try {recovery=errors(error);}
      catch(failure){fatal=failure instanceof ExecutionLimitError;throw failure;}
      finally {if(!fatal)meter?.checkpoint();}
      if(recovery.replacement.length!==0)minimumMaximum=Math.max(minimumMaximum,recovery.replacement.storageMaximum(meter));
      reserve(recovery.replacement.length);
      for(const point of recovery.replacement){meter?.checkpoint();output[written++]=point;}
      input=recovery.input;end=recovery.position;
    }else if(errors!=="ignore")throw new PythonDecodeError(encoding,input,start,end,reason,meter,initial);
    start=end;
  }
  // Result/string metadata and both array headers are independent of payload;
  // CodePointString separately admits the copied code-point storage.
  meter?.checkpoint(0,192);
  return {text:CodePointString.fromUnicodeWriter(output.subarray(0,written),minimumMaximum,meter),consumed:final?originalLength:start,byteorder};
}

/** Complete-string encoding. Surrogate faults are individual code points in
 * these codecs; unlike UTF-8, surrogateescape cannot emit an unaligned byte. */
export function encodeWideUnicode(input:CodePointString,width:16|32,byteorder:UnicodeByteOrder=0,errors:Utf8EncodeErrors|WideEncodeRecovery="strict",meter?:ExecutionMeter):Uint8Array {
  const size=width/8,little=byteorder!==1,capacity=size+input.length*size*(errors==="xmlcharrefreplace"?8:errors==="namereplace"||errors==="backslashreplace"?6:2);
  // Empty payloads still allocate typed-array objects. Admit their storage
  // before allocation, including the independently owned result below.
  meter?.checkpoint(1,64+capacity);
  let output=new Uint8Array(capacity);
  const encoding=`utf-${width}${byteorder===0?"":little?"-le":"-be"}`;
  let written=0;
  const reserve=(count:number)=>{
    if(written+count<=output.length)return;
    const size=Math.max(written+count,output.length*2);meter?.checkpoint(written+1,128+size);
    const grown=new Uint8Array(size);grown.set(output.subarray(0,written));output=grown;
  };
  if(byteorder===0){writeWord(output,0,0xfeff,size,little);written=size;}
  for(let index=0;index<input.length;index++){
    const point=input.codePointAt(BigInt(index),meter);
    reserve(size*8);
    if(point>=0xd800&&point<=0xdfff&&errors!=="surrogatepass"){
      // The native fault and its diagnostic own storage independently of the
      // output buffer. Admit them before throwing or entering guest recovery.
      if(typeof errors==="function"||errors==="strict"||errors==="surrogateescape")meter?.checkpoint(0,512);
      if(typeof errors==="function"){
        const error=new PythonEncodeError(encoding,input,index,index+1,"surrogates not allowed");
        let fatal=false,recovery:ReturnType<WideEncodeRecovery>;
        try {recovery=errors(error);}
        catch(failure){fatal=failure instanceof ExecutionLimitError;throw failure;}
        finally {if(!fatal)meter?.checkpoint();}
        let encoded:Uint8Array;
        if(recovery.replacement instanceof Uint8Array){
          if(recovery.replacement.length%size!==0){
            rejectEncodingReplacement(recovery,error,meter);
          }
          encoded=recovery.replacement;
        }else{
          // Like UTF-8, native wide encoders require the ASCII storage flag,
          // after resume-position validation, even for recovered ASCII points.
          if(!recovery.replacement.isAsciiStorage(meter))rejectEncodingReplacement(recovery,error,meter);
          encoded=encodeWideUnicode(recovery.replacement,width,little?-1:1,"strict",meter);
        }
        reserve(encoded.length);meter?.checkpoint(encoded.length);
        output.set(encoded,written);written+=encoded.length;
        index=recovery.position-1;
        continue;
      }
      if(errors==="strict"||errors==="surrogateescape")throw new PythonEncodeError(encoding,input,index,index+1,"surrogates not allowed");
      if(errors==="ignore")continue;
      const replacement=errors==="replace"?"?":errors==="xmlcharrefreplace"?`&#${point};`:`\\u${point.toString(16)}`;
      for(let offset=0;offset<replacement.length;offset++){
        meter?.checkpoint();writeWord(output,written,replacement.charCodeAt(offset),size,little);written+=size;
      }
    }else if(width===16&&point>0xffff){
      writeWord(output,written,0xd800+((point-0x10000)>>10),size,little);
      writeWord(output,written+size,0xdc00+((point-0x10000)&1023),size,little);written+=2*size;
    }else {writeWord(output,written,point,size,little);written+=size;}
  }
  meter?.checkpoint(written,64+written);
  return output.slice(0,written);
}

function readWord(input:Uint8Array,start:number,size:number,little:boolean):number {
  let word=0;
  for(let index=0;index<size;index++)word=word*256+input[start+(little?size-index-1:index)];
  return word;
}

function writeWord(output:Uint8Array,start:number,word:number,size:number,little:boolean):void {
  for(let index=0;index<size;index++){output[start+(little?index:size-index-1)]=word&255;word>>>=8;}
}
