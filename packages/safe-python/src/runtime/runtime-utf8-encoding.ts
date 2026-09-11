import type {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";
import {encodeUtf8,type Utf8EncodeErrors} from "./utf8-encode.js";

export type RuntimeTextEncoder=(text:CodePointString,encoding:string,errors:string,meter:ExecutionMeter,invocation:BuiltinInvocationContext|undefined)=>RuntimeValue;

const aliases=new Set(["utf8","utf_8","u8","utf","utf8_ucs2","utf8_ucs4","cp65001"]);
const handlers=new Set(["strict","ignore","replace","surrogateescape","surrogatepass","backslashreplace","xmlcharrefreplace","namereplace"]);

/** Native UTF-8 encoding with an explicit extension for other codecs and custom
 * error handlers. Codec lookup includes empty input; error lookup remains lazy.
 * Returned bytes own their storage and never alias the source string. */
export function createRuntimeUtf8Encoder(values:RuntimeValues,fallback?:RuntimeTextEncoder):RuntimeTextEncoder {
  return (text,encoding,errors,meter,invocation)=>{
    let fatal=false;
    try {
      meter.checkpoint(1,96);
      if(!aliases.has(normalizeRuntimeEncodingName(encoding,meter))){
        if(fallback!==undefined)return fallback(text,encoding,errors,meter,invocation);
        meter.checkpoint(0,160+2*encoding.length);
        throw new PythonRuntimeError("LookupError",`unknown encoding: ${encoding}`);
      }
      const known=handlers.has(errors),handler=known?errors as Utf8EncodeErrors:"strict";
      try{return values.bytes(encodeUtf8(text,handler,meter));}
      catch(error){
        if(!(error instanceof PythonEncodeError)||known)throw error;
        if(fallback!==undefined)return fallback(text,encoding,errors,meter,invocation);
        meter.checkpoint(0,192+2*errors.length);
        throw new PythonRuntimeError("LookupError",`unknown error handler name '${errors}'`);
      }
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  };
}
