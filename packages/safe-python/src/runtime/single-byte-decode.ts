import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {Utf8DecodeErrors,Utf8DecodeRecovery,Utf8Decoded} from "./utf8-decode.js";

/** ASCII/Latin-1 decoding with registry-validated recovery. The low-level codec
 * reports original input consumption even when a handler replaces its object. */
export function decodeSingleByte(input:Uint8Array,encoding:"ascii"|"latin-1",errors:Utf8DecodeErrors|Utf8DecodeRecovery,meter:ExecutionMeter):Utf8Decoded {
  let fatal=false;
  try{
    const consumed=input.length,limit=encoding==="ascii"?128:256,points:number[]=[];
    let minimumMaximum=127;
    meter.checkpoint(1,32);
    for(let index=0;index<input.length;){
      meter.checkpoint();
      const byte=input[index];
      if(byte<limit){meter.checkpoint(0,8);points.push(byte);}
      else if(typeof errors==="function"){
        const recovery=errors(new PythonDecodeError(encoding,input,index,index+1,`ordinal not in range(${limit})`,meter));
        meter.checkpoint();
        if(recovery.replacement.length!==0)minimumMaximum=Math.max(minimumMaximum,recovery.replacement.storageMaximum(meter));
        for(const point of recovery.replacement){meter.checkpoint(1,8);points.push(point);}
        input=recovery.input;index=recovery.position;
        continue;
      }else if(errors==="replace"){meter.checkpoint(0,8);points.push(0xfffd);}
      else if(errors==="surrogateescape"){meter.checkpoint(0,8);points.push(0xdc00+byte);}
      else if(errors==="backslashreplace"){
        meter.checkpoint(0,32);
        points.push(92,120,"0123456789abcdef".charCodeAt(byte>>4),"0123456789abcdef".charCodeAt(byte&15));
      }else if(errors!=="ignore")throw new PythonDecodeError(encoding,input,index,index+1,`ordinal not in range(${limit})`,meter);
      index++;
    }
    // The result retains its record, point-string wrapper and two typed arrays
    // even for empty text. Admit those records before publishing the result;
    // CodePointString separately admits its copied character payload.
    meter.checkpoint(points.length,192+points.length*4);
    return {text:CodePointString.fromUnicodeWriter(Uint32Array.from(points),minimumMaximum,meter),consumed};
  }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}
