import {unicodeCodecName} from "../unicode-codec-name.js";
import {lookupRuntimeEncodingMap} from "./runtime-encoding-map.js";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError,type DecodeErrorLocation} from "./decode-error.js";
import {PythonEncodeError,type EncodeErrorLocation} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeIntegerPayload} from "./runtime-integer-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeGetItem} from "./runtime-subscription.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {encodeSingleByte} from "./single-byte-encode.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";
import type {Utf8Decoded,Utf8DecodeRecovery} from "./utf8-decode.js";
import type {Utf8EncodeErrors,Utf8EncodeRecovery} from "./utf8-encode.js";

/** Arbitrary guest character maps use ordinary subscription, never coerced
 * mapping results or host codecs. Callers bind custom policies through the
 * interpreter's RuntimeCodecRecovery; public argument binding is separate. */
export class RuntimeCharmap {
  constructor(readonly values:RuntimeValues,readonly meter:ExecutionMeter) {
    // Admit the retained adapter before it can escape, even if the caller never
    // starts a mapping operation. Terminal budgets must also reject new owners.
    meter.checkpoint(1,64);
  }

  #lookup(mapping:RuntimeValue,point:number,context:BuiltinInvocationContext):RuntimeValue {
    const {meter,values}=this;
    try{return runtimeGetItem(mapping,values.integer(point),values,meter,context,context.integerIndex);}
    catch(error){
      if(error instanceof ExecutionLimitError)throw error;
      meter.checkpoint();
      const missing=runtimeExceptionMatches(error,"LookupError",context);
      // Classification can cross an explicit service boundary. Do not enter
      // recovery or replacement rejection after that service has cancelled.
      meter.checkpoint();
      if(missing)return values.none;
      throw error;
    }
  }

  #encodeLookup(mapping:RuntimeValue,point:number,context:BuiltinInvocationContext):Uint8Array|undefined {
    const encoded=lookupRuntimeEncodingMap(mapping,point,this.meter);
    if(encoded!==undefined){
      if(encoded<0)return;
      this.meter.checkpoint(1,1);return new Uint8Array([encoded]);
    }
    const {meter}=this,value=this.#lookup(mapping,point,context);
    if(value.kind==="none")return;
    const integer=runtimeIntegerPayload(value);
    if(integer!==undefined){
      const number=BigInt(integer.value);
      if(number<0n||number>255n){
        meter.checkpoint(0,192);
        throw new PythonRuntimeError("TypeError","character mapping must be in range(256)");
      }
      meter.checkpoint(1,1);return new Uint8Array([Number(number)]);
    }
    const native=value.kind==="instance"?value.native:value;
    if(native?.kind==="bytes")return native.value.toUint8Array(meter);
    const name=diagnosticTypeName(context.typeName?.(value)??(value.kind==="instance"?value.type.value.diagnosticName:value.kind),meter,400);
    // Mapping and type-name callbacks can consume the remaining allowance.
    // Admit exception storage after those callbacks, before a guest can catch it.
    meter.checkpoint(0,320+name.length*2);
    throw new PythonRuntimeError("TypeError",`character mapping must return integer, bytes or None, not ${name}`);
  }

  decode(input:Uint8Array,mapping:RuntimeValue,errors:Utf8EncodeErrors|Utf8DecodeRecovery,context:BuiltinInvocationContext):Utf8Decoded {
    const {meter}=this;let fatal=false;
    try{
      if(mapping.kind==="none")return decodeSingleByte(input,"latin-1",typeof errors==="function"?errors:"strict",meter);
      const consumed=input.length,points:number[]=[];meter.checkpoint(1,32);
      let minimumMaximum=127;
      let initial:DecodeErrorLocation|undefined;
      for(let index=0;index<input.length;){
        const byte=input[index],value=this.#lookup(mapping,byte,context),integer=runtimeIntegerPayload(value),text=runtimeStringPayload(value)?.value;
        let point:number|undefined;
        if(integer!==undefined){
          const number=BigInt(integer.value);
          if(number<0n||number>0x10ffffn){
            meter.checkpoint(0,192);
            throw new PythonRuntimeError("TypeError","character mapping must be in range(0x110000)");
          }
          point=Number(number);
        }else if(text!==undefined){
          if(text.length===1)point=text.codePointAt(0n,meter);
          else{
            if(text.length!==0)minimumMaximum=Math.max(minimumMaximum,text.storageMaximum(meter));
            for(const character of text){meter.checkpoint(1,8);points.push(character);}
            index++;continue;
          }
        }else if(value.kind!=="none"){
          meter.checkpoint(0,192);
          throw new PythonRuntimeError("TypeError","character mapping must return integer, None or str");
        }
        if(point!==undefined&&point!==0xfffe){meter.checkpoint(1,8);points.push(point);index++;continue;}
        // Surrogateescape invokes a cached UnicodeDecodeError even for recovered
        // bytes. Later failures update its fields but retain the original args.
        if(errors==="surrogateescape"&&initial===undefined){
          meter.checkpoint(0,48);initial={start:index,end:index+1,reason:"character maps to <undefined>"};
        }
        const error=new PythonDecodeError("charmap",input,index,index+1,"character maps to <undefined>",meter,initial);
        if(typeof errors==="function"){
          const recovery=errors(error);meter.checkpoint();
          if(recovery.replacement.length!==0)minimumMaximum=Math.max(minimumMaximum,recovery.replacement.storageMaximum(meter));
          for(const character of recovery.replacement){meter.checkpoint(1,8);points.push(character);}
          input=recovery.input;index=recovery.position;continue;
        }
        if(errors==="replace"){meter.checkpoint(1,8);points.push(0xfffd);}
        else if(errors==="surrogateescape"&&byte>=128){meter.checkpoint(1,8);points.push(0xdc00+byte);}
        else if(errors==="backslashreplace"){
          meter.checkpoint(1,32);points.push(92,120,"0123456789abcdef".charCodeAt(byte>>4),"0123456789abcdef".charCodeAt(byte&15));
        }else if(errors==="xmlcharrefreplace"||errors==="namereplace")throw new PythonRuntimeError("TypeError","don't know how to handle UnicodeDecodeError in error callback");
        else if(errors!=="ignore")throw error;
        index++;
      }
      // The returned record, string wrapper and both typed-array headers own
      // storage even for empty output. Admit them after mapping/recovery calls,
      // before publishing a result; the string also charges its copied payload.
      meter.checkpoint(points.length,192+points.length*4);
      return {text:CodePointString.fromUnicodeWriter(Uint32Array.from(points),minimumMaximum,meter),consumed};
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }

  encode(input:CodePointString,mapping:RuntimeValue,errors:Utf8EncodeErrors|Utf8EncodeRecovery,context:BuiltinInvocationContext):Uint8Array {
    const {meter}=this;let fatal=false;
    try{
      if(mapping.kind==="none")return encodeSingleByte(input,"latin-1",errors,meter,point=>unicodeCodecName(point,meter));
      const output:number[]=[];meter.checkpoint(1,32);
      let initial:EncodeErrorLocation|undefined;
      const append=(bytes:Uint8Array)=>{for(const byte of bytes){meter.checkpoint(1,8);output.push(byte);}};
      for(let index=0;index<input.length;){
        const result=this.#encodeLookup(mapping,input.codePointAt(BigInt(index),meter),context);
        if(result!==undefined){append(result);index++;continue;}
        let end=index+1;
        // CPython probes the next encodable character to delimit the error,
        // then looks it up again when actual encoding resumes. Keep side effects.
        while(end<input.length&&this.#encodeLookup(mapping,input.codePointAt(BigInt(end),meter),context)===undefined)end++;
        // These policies resolve an error callback in CPython; replace and
        // xmlcharrefreplace use native fast paths without a cached exception.
        if(initial===undefined&&(errors==="surrogateescape"||errors==="backslashreplace"||errors==="namereplace")){
          meter.checkpoint(0,48);initial={start:index,end,reason:"character maps to <undefined>"};
        }
        // Mapping callbacks, including the lookahead that delimits this span,
        // may consume the remaining allowance. Admit the fault and diagnostic
        // before constructing them or entering an error handler.
        meter.checkpoint(0,512);
        const error=new PythonEncodeError("charmap",input,index,end,"character maps to <undefined>",initial);
        let replacement:CodePointString|Uint8Array,recovery:ReturnType<Utf8EncodeRecovery>|undefined;
        if(typeof errors==="function"){
          recovery=errors(error);meter.checkpoint();replacement=recovery.replacement;
        }else if(errors==="ignore"){index=end;continue;}
        else if(errors==="strict"||errors==="surrogatepass")throw error;
        else if(errors==="surrogateescape"){
          meter.checkpoint(end-index,end-index);const bytes=new Uint8Array(end-index);
          for(let offset=index;offset<end;offset++){
            const point=input.codePointAt(BigInt(offset),meter);
            if(point<0xdc80||point>0xdcff)throw error;
            bytes[offset-index]=point-0xdc00;
          }
          replacement=bytes;
        }else{
          const points:number[]=[];meter.checkpoint(1,32);
          for(let offset=index;offset<end;offset++){
            const point=input.codePointAt(BigInt(offset),meter);let fragment:string;
            if(errors==="replace")fragment="?";
            else if(errors==="xmlcharrefreplace")fragment=`&#${point};`;
            else{
              const name=errors==="namereplace"?unicodeCodecName(point,meter):undefined;
              fragment=name===undefined?`\\${point<=0xff?"x":point<=0xffff?"u":"U"}${point.toString(16).padStart(point<=0xff?2:point<=0xffff?4:8,"0")}`:`\\N{${name}}`;
            }
            meter.checkpoint(1,64+fragment.length*2);
            for(const character of fragment){meter.checkpoint(1,8);points.push(character.codePointAt(0)!);}
          }
          meter.checkpoint(points.length,points.length*4);replacement=new CodePointString(Uint32Array.from(points),meter);
        }
        if(replacement instanceof Uint8Array)append(replacement);
        else for(const point of replacement){
          const bytes=this.#encodeLookup(mapping,point,context);
          if(bytes===undefined){recovery?.rejectReplacement?.();throw recovery?.failure??error;}
          append(bytes);
        }
        index=recovery?.position??end;
      }
      meter.checkpoint(output.length,output.length);return Uint8Array.from(output);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }
}
