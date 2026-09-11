import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import type {RuntimeTextDecoder} from "./runtime-string-decoding.js";
import type {RuntimeValues} from "./runtime-values.js";
import {normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import {decodeUtf8,type Utf8DecodeErrors} from "./utf8-decode.js";

const aliases=new Set(["utf8","utf_8","u8","utf","utf8_ucs2","utf8_ucs4","cp65001"]);
const handlers=new Set(["strict","ignore","replace","surrogateescape","surrogatepass","backslashreplace"]);

/** Native UTF-8 text codec with an explicit extension for other codecs and
 * custom error handlers. Error-handler lookup is lazy, as in Python: valid input
 * accepts unknown handler names. Empty input never invokes codec lookup. */
export function createRuntimeUtf8Decoder(values:RuntimeValues,fallback?:RuntimeTextDecoder):RuntimeTextDecoder {
  return (bytes,encoding,errors,meter,invocation)=>{
    let fatal=false;
    try {
      meter.checkpoint(1,96);
      if(bytes.length===0)return values.string("");
      if(!aliases.has(normalizeRuntimeEncodingName(encoding,meter))){
        if(fallback!==undefined)return fallback(bytes,encoding,errors,meter,invocation);
        meter.checkpoint(0,160+2*encoding.length);
        throw new PythonRuntimeError("LookupError",`unknown encoding: ${encoding}`);
      }
      const known=handlers.has(errors),handler=known?errors as Utf8DecodeErrors:"strict";
      try{return values.stringPoints(decodeUtf8(bytes.toUint8Array(meter),handler,meter).text);}
      catch(error){
        if(!(error instanceof PythonDecodeError)||known)throw error;
        if(fallback!==undefined)return fallback(bytes,encoding,errors,meter,invocation);
        if(errors==="xmlcharrefreplace"||errors==="namereplace")throw new PythonRuntimeError("TypeError","don't know how to handle UnicodeDecodeError in error callback");
        meter.checkpoint(0,192+2*errors.length);
        throw new PythonRuntimeError("LookupError",`unknown error handler name '${errors}'`);
      }
    } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  };
}
