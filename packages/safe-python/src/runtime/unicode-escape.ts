import {lookupUnicodeName} from "../unicode-names.js";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {Utf8Decoded,Utf8DecodeErrors,Utf8DecodeRecovery} from "./utf8-decode.js";

/** Both escape encoders accept every Python code point, including surrogates.
 * Raw mode preserves all Latin-1 bytes, including backslashes. */
export function encodeUnicodeEscape(input:CodePointString,raw=false,meter?:ExecutionMeter):Uint8Array {
  meter?.checkpoint(1,64+input.length*10);
  const output=new Uint8Array(input.length*10);
  let written=0;
  for(const point of input){
    meter?.checkpoint();
    if(raw&&point<256||!raw&&point>=32&&point<127&&point!==92){output[written++]=point;continue;}
    const short=point===92?"\\\\":point===9?"\\t":point===10?"\\n":point===13?"\\r":undefined;
    const escape=!raw&&short!==undefined?short:point<256?`\\x${point.toString(16).padStart(2,"0")}`:point<65536?`\\u${point.toString(16).padStart(4,"0")}`:`\\U${point.toString(16).padStart(8,"0")}`;
    for(let index=0;index<escape.length;index++)output[written++]=escape.charCodeAt(index);
  }
  // Both typed arrays own storage records even when the payload is empty.
  meter?.checkpoint(written,64+written);
  return output.slice(0,written);
}

/** Warnings are delivered after successful decoding through an explicit service.
 * The caller owns warning filtering, guest metadata and exception conversion. */
export function decodeUnicodeEscape(input:Uint8Array,raw:boolean,errors:Utf8DecodeErrors|Utf8DecodeRecovery,meter:ExecutionMeter|undefined,final:boolean,warn:(message:string, marker:number, position:number)=>void):Utf8Decoded {
  const originalLength=input.length;
  meter?.checkpoint(1,64+input.length*4);
  let output=new Uint32Array(input.length),written=0,start=0,invalid:number|undefined,invalidPosition=0,minimumMaximum=127;
  const append=(point:number)=>{
    if(written===output.length){
      const size=Math.max(16,output.length*2);meter?.checkpoint(written+1,64+size*4);
      const grown=new Uint32Array(size);grown.set(output);output=grown;
    }
    output[written++]=point;
  };
  while(start<input.length){
    meter?.checkpoint();
    if(input[start]!==92){append(input[start++]);continue;}
    let end=start+1,reason:string|undefined,incomplete=false;
    if(end===input.length){
      if(raw&&final){append(92);start=end;continue;}
      reason="\\ at end of string";incomplete=true;
    }else{
      const marker=input[end++];
      if(marker===117||marker===85||!raw&&marker===120){
        const width=marker===117?4:marker===85?8:2;
        reason=width===4?"truncated \\uXXXX escape":width===8?"truncated \\UXXXXXXXX escape":"truncated \\xXX escape";
        let point=0,count=0;
        for(;count<width;count++){
          meter?.checkpoint();
          if(end===input.length){incomplete=true;break;}
          const byte=input[end],digit=byte>=48&&byte<=57?byte-48:byte>=65&&byte<=70?byte-55:byte>=97&&byte<=102?byte-87:-1;
          if(digit<0)break;
          point=point*16+digit;end++;
        }
        if(count===width){
          if(point>0x10ffff)reason=raw?"\\Uxxxxxxxx out of range":"illegal Unicode character";
          else {append(point);reason=undefined;}
        }
      }else if(raw){append(92);append(marker);}
      else if(marker===78){
        reason="malformed \\N character escape";
        if(end===input.length)incomplete=true;
        else if(input[end]===123){
          const nameStart=++end;
          while(end<input.length&&input[end]!==125){meter?.checkpoint();end++;}
          if(end===input.length)incomplete=true;
          else if(end>nameStart){
            meter?.checkpoint(end-nameStart,(end-nameStart)*2);
            let name="";
            for(let index=nameStart;index<end;index++)name+=String.fromCharCode(input[index]);
            end++;
            const character=lookupUnicodeName(name,meter);
            if(character===undefined)reason="unknown Unicode character name";
            else {append(character.codePointAt(0)!);reason=undefined;}
          }
        }
      }else if(marker>=48&&marker<=55){
        let point=marker-48;
        for(let count=1;count<3&&end<input.length&&input[end]>=48&&input[end]<=55;count++)point=point*8+input[end++]-48;
        if(point>255&&invalid===undefined){invalid=point;invalidPosition=start;}
        append(point);
      }else{
        const escaped=marker===92||marker===39||marker===34?marker:marker===97?7:marker===98?8:marker===102?12:marker===110?10:marker===114?13:marker===116?9:marker===118?11:undefined;
        if(escaped!==undefined)append(escaped);
        else if(marker!==10){if(invalid===undefined){invalid=marker;invalidPosition=start;}append(92);append(marker);}
      }
    }
    if(incomplete&&!final)break;
    if(reason!==undefined){
      if(errors==="replace")append(0xfffd);
      else if(errors==="backslashreplace"){
        for(let index=start;index<end;index++){
          meter?.checkpoint();append(92);append(120);
          append("0123456789abcdef".charCodeAt(input[index]>>4));append("0123456789abcdef".charCodeAt(input[index]&15));
        }
      }else if(errors!=="ignore"){
        const error=new PythonDecodeError(raw?"rawunicodeescape":"unicodeescape",input,start,end,reason,meter);
        if(typeof errors!=="function")throw error;
        let fatal=false,recovery:ReturnType<Utf8DecodeRecovery>;
        try {recovery=errors(error);}
        catch(failure){fatal=failure instanceof ExecutionLimitError;throw failure;}
        finally {if(!fatal)meter?.checkpoint();}
        if(recovery.replacement.length!==0)minimumMaximum=Math.max(minimumMaximum,recovery.replacement.storageMaximum(meter));
        for(const point of recovery.replacement){meter?.checkpoint();append(point);}
        input=recovery.input;end=recovery.position;
      }
    }
    start=end;
  }
  if(invalid!==undefined){
    // The diagnostic and its temporary escape spelling own storage before the
    // warning service runs. The marker is one byte or at most three octal
    // digits, so this bounds both message variants without rendering first.
    meter?.checkpoint(0,384);
    const message=invalid>255?`"\\${invalid.toString(8)}" is an invalid octal escape sequence. Such sequences will not work in the future. `:`"\\${String.fromCharCode(invalid)}" is an invalid escape sequence. Such sequences will not work in the future. `;
    let fatal=false;
    try {warn(message,invalid,invalidPosition);}
    catch(failure){fatal=failure instanceof ExecutionLimitError;throw failure;}
    finally {if(!fatal)meter?.checkpoint();}
  }
  // Unlike UTF-8, even a nonfinal call reports the original length when the
  // replacement input is exhausted. Only an incomplete escape returns a cursor.
  // Admit the result, string wrapper and array metadata even for empty output.
  // CodePointString separately charges the copied code-point payload.
  meter?.checkpoint(0,192);
  return {text:CodePointString.fromUnicodeWriter(output.subarray(0,written),minimumMaximum,meter),consumed:start===input.length?originalLength:start};
}

/** Owned buffering for BufferedIncrementalDecoder; warning failures, like codec
 * failures, leave the buffer from the previous successful call intact. */
export class UnicodeEscapeDecoder {
  #pending=new Uint8Array();
  constructor(readonly raw:boolean,public errors:Utf8DecodeErrors|Utf8DecodeRecovery,readonly warn:(message:string)=>void) {}

  decode(input:Uint8Array,final=false,meter?:ExecutionMeter):CodePointString {
    meter?.checkpoint();
    let combined=input;
    if(this.#pending.length){
      const length=this.#pending.length+input.length;meter?.checkpoint(length,64+length);
      combined=new Uint8Array(length);combined.set(this.#pending);combined.set(input,this.#pending.length);
    }
    const result=decodeUnicodeEscape(combined,this.raw,this.errors,meter,final,this.warn);
    const remaining=Math.max(0,combined.length-result.consumed);meter?.checkpoint(remaining+1,64+remaining);
    this.#pending=combined.slice(result.consumed);
    return result.text;
  }

  getstate(meter?:ExecutionMeter):readonly [Uint8Array,bigint] {
    meter?.checkpoint(this.#pending.length+1,96+this.#pending.length);
    return [this.#pending.slice(),0n];
  }

  setstate(state:readonly [Uint8Array,bigint],meter?:ExecutionMeter):void {
    meter?.checkpoint(state[0].length+1,64+state[0].length);this.#pending=new Uint8Array(state[0]);
  }

  reset(meter?:ExecutionMeter):void {meter?.checkpoint(1,64);this.#pending=new Uint8Array();}
}
