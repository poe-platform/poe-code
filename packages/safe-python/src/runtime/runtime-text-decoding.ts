import {decodeRuntimeCoreText} from "./runtime-core-text-codec.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import {displayRuntimeEncodingName,normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import type {RuntimeTextDecoder} from "./runtime-string-decoding.js";
import {createRuntimeUtf8Decoder} from "./runtime-utf8-decoding.js";
import type {RuntimeValues} from "./runtime-values.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {runtimeTextCodecFastPaths,resolveCoreCodec} from "./runtime-core-codec-aliases.js";
import {throwRuntimeCodecFailure} from "./runtime-codec-failure.js";

const handlers=new Set(["strict","ignore","replace","surrogateescape","surrogatepass","backslashreplace"]);

/** Core text codecs. A supplied decoder owns registry lookup outside Python's
 * native shortcut spellings, including aliases of core codecs. Custom error
 * handlers are explicit capabilities; no process-global registry is consulted. */
export function createRuntimeTextDecoder(values:RuntimeValues,fallback?:RuntimeTextDecoder):RuntimeTextDecoder {
  const utf8=createRuntimeUtf8Decoder(values,fallback);
  return (bytes,encoding,errors,meter,invocation)=>{
    let fatal=false,annotate=false;
    try {
      meter.checkpoint(1,96);
      if(bytes.length===0)return values.string("");
      const name=normalizeRuntimeEncodingName(encoding,meter);
      meter.checkpoint(name.length,32+name.length*2);
      // PyUnicode_Decode supplies an ownerless read-only memoryview, including
      // for aliases of native codecs. The explicit provider owns that guest
      // object and its lifetime; never replace it with bytes for convenience.
      if(!runtimeTextCodecFastPaths.has(name)&&invocation?.codecs!==undefined&&invocation.buffers?.createReadOnlyView!==undefined){
        const view=invocation.buffers.createReadOnlyView(bytes);
        meter.checkpoint();
        return invocation.codecs.transform("decode",view,encoding,errors,invocation,true);
      }
      if(fallback!==undefined&&!runtimeTextCodecFastPaths.has(name))return fallback(bytes,encoding,errors,meter,invocation);
      const codec=resolveCoreCodec(name),latin=codec==="latin_1";
      if(codec!==undefined&&invocation?.codecs!==undefined){
        annotate=!runtimeTextCodecFastPaths.has(name);
        return values.stringPoints(decodeRuntimeCoreText(codec,bytes.toUint8Array(meter),errors??"strict",true,invocation.codecs,invocation).text);
      }
      if(!latin&&codec!=="ascii")return utf8(bytes,encoding,errors,meter,invocation);
      annotate=!runtimeTextCodecFastPaths.has(name);
      const policy=errors??"strict",known=typeof policy==="string"&&handlers.has(policy);
      try{return values.stringPoints(decodeSingleByte(bytes.toUint8Array(meter),latin?"latin-1":"ascii",known?policy as Utf8DecodeErrors:"strict",meter).text);}
      catch(error){
        if(!(error instanceof PythonDecodeError)||known)throw error;
        if(fallback!==undefined){annotate=false;return fallback(bytes,encoding,errors,meter,invocation);}
        if(policy==="xmlcharrefreplace"||policy==="namereplace")throw new PythonRuntimeError("TypeError","don't know how to handle UnicodeDecodeError in error callback");
        meter.checkpoint(0,192+policy.length*2);throw new PythonRuntimeError("LookupError",`unknown error handler name '${diagnosticTypeName(displayRuntimeEncodingName(policy,meter),meter,400)}'`);
      }
    } catch(error){
      try {
        if(annotate)throwRuntimeCodecFailure(error,"decode",encoding,meter,invocation);
        throw error;
      } catch(failure){
        // Annotation invokes interpreter hooks and can itself terminate execution.
        fatal=failure instanceof ExecutionLimitError;
        throw failure;
      }
    }
    finally{if(!fatal)meter.checkpoint();}
  };
}
