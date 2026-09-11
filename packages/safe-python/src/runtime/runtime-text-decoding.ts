import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import {normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import type {RuntimeTextDecoder} from "./runtime-string-decoding.js";
import {createRuntimeUtf8Decoder} from "./runtime-utf8-decoding.js";
import type {RuntimeValues} from "./runtime-values.js";

const asciiNames=new Set(["ascii","646","ansi_x3.4_1968","ansi_x3_4_1968","ansi_x3.4_1986","cp367","csascii","ibm367","iso646_us","iso_646.irv_1991","iso_ir_6","us","us_ascii"]);
const latinNames=new Set(["latin_1","8859","cp819","csisolatin1","ibm819","iso8859","iso8859_1","iso_8859_1","iso_8859_1_1987","iso_ir_100","l1","latin","latin1"]);

/** Core text codecs. Other encodings and custom error handlers are explicit
 * execution capabilities; no process-global codec registry is consulted. */
export function createRuntimeTextDecoder(values:RuntimeValues,fallback?:RuntimeTextDecoder):RuntimeTextDecoder {
  const utf8=createRuntimeUtf8Decoder(values,fallback);
  return (bytes,encoding,errors,meter,invocation)=>{
    let fatal=false;
    try {
      meter.checkpoint(1,96);
      if(bytes.length===0)return values.string("");
      const name=normalizeRuntimeEncodingName(encoding,meter),latin=latinNames.has(name);
      if(!latin&&!asciiNames.has(name))return utf8(bytes,encoding,errors,meter,invocation);
      const capacity=bytes.length*(!latin&&errors==="backslashreplace"?4:1);
      meter.checkpoint(1,capacity*4);
      const points=new Uint32Array(capacity);let written=0,index=0;
      for(const byte of bytes){
        meter.checkpoint();
        if(latin||byte<128)points[written++]=byte;
        else if(errors==="replace")points[written++]=0xfffd;
        else if(errors==="surrogateescape")points[written++]=0xdc00+byte;
        else if(errors==="backslashreplace"){
          points[written++]=92;points[written++]=120;
          points[written++]="0123456789abcdef".charCodeAt(byte>>4);points[written++]="0123456789abcdef".charCodeAt(byte&15);
        }else if(errors!=="ignore"){
          if(errors==="strict"||errors==="surrogatepass")throw new PythonDecodeError("ascii",bytes.toUint8Array(meter),index,index+1,"ordinal not in range(128)",meter);
          if(fallback!==undefined)return fallback(bytes,encoding,errors,meter,invocation);
          if(errors==="xmlcharrefreplace"||errors==="namereplace")throw new PythonRuntimeError("TypeError","don't know how to handle UnicodeDecodeError in error callback");
          meter.checkpoint(0,192+errors.length*2);throw new PythonRuntimeError("LookupError",`unknown error handler name '${errors}'`);
        }
        index++;
      }
      return values.stringPoints(new CodePointString(points.subarray(0,written),meter));
    } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  };
}
