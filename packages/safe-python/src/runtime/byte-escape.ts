import type {ImmutableBytes} from "./immutable-bytes.js";
import {displayRuntimeEncodingName} from "./runtime-encoding-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";

/** Byte escapes have their own policy contract: malformed hex uses only strict,
 * ignore or replace; other escapes never consult the codec error registry. */
export function decodeByteEscape(input:Uint8Array,errors:string|ImmutableBytes,meter:ExecutionMeter,warn:(message:string, marker:number, position:number)=>void):Uint8Array {
  // Temporary and returned typed arrays each own storage metadata, including
  // when decoding produces no bytes. Admit them independently of payload size.
  meter.checkpoint(1,64+input.length);
  const output=new Uint8Array(input.length);
  let written=0,invalid:number|undefined,invalidPosition=0;
  const hex=(byte:number)=>byte>=48&&byte<=57?byte-48:byte>=65&&byte<=70?byte-55:byte>=97&&byte<=102?byte-87:-1;
  for(let index=0;index<input.length;){
    meter.checkpoint();
    const byte=input[index++];
    if(byte!==92){output[written++]=byte;continue;}
    const start=index-1;
    if(index===input.length){
      meter.checkpoint(0,256);
      throw new PythonRuntimeError("ValueError","Trailing \\ in string");
    }
    const marker=input[index++];
    if(marker===10)continue;
    const short=marker===92||marker===39||marker===34?marker:marker===97?7:marker===98?8:marker===102?12:marker===110?10:marker===114?13:marker===116?9:marker===118?11:undefined;
    if(short!==undefined){output[written++]=short;continue;}
    if(marker>=48&&marker<=55){
      let point=marker-48;
      for(let count=1;count<3&&index<input.length&&input[index]>=48&&input[index]<=55;count++)point=point*8+input[index++]-48;
      if(point>255&&invalid===undefined){invalid=point;invalidPosition=start;}
      output[written++]=point;continue;
    }
    if(marker===120){
      const first=hex(input[index]),second=hex(input[index+1]);
      if(first>=0&&second>=0){output[written++]=first*16+second;index+=2;continue;}
      if(errors==="strict"){
        meter.checkpoint(0,256);
        throw new PythonRuntimeError("ValueError",`invalid \\x escape at position ${start}`);
      }
      if(errors==="replace")output[written++]=63;
      else if(errors!=="ignore"){
        // Fault storage is independent of diagnostic rendering and scratch
        // bytes. Admit it before a catchable error can escape the kernel.
        meter.checkpoint(0,256);
        throw new PythonRuntimeError("ValueError",`decoding error; unknown error handling code: ${displayRuntimeEncodingName(errors,meter,400)}`);
      }
      if(first>=0)index++;
      continue;
    }
    if(invalid===undefined){invalid=marker;invalidPosition=start;}
    output[written++]=92;output[written++]=marker;
  }
  if(invalid!==undefined){
    const octal=invalid>255;
    let fatal=false;
    try{warn(`b"\\${octal?invalid.toString(8):String.fromCharCode(invalid)}" is an invalid ${octal?"octal escape":"escape"} sequence. Such sequences will not work in the future. `,invalid,invalidPosition);}
    catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }
  meter.checkpoint(written,64+written);
  return output.slice(0,written);
}
