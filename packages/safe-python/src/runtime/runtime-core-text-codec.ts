import type {ImmutableBytes} from "./immutable-bytes.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import type {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";
import {encodeSingleByte} from "./single-byte-encode.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {encodeUtf8,type Utf8EncodeErrors,type Utf8EncodeRecovery} from "./utf8-encode.js";
import {decodeUtf8,type Utf8DecodeErrors,type Utf8DecodeRecovery} from "./utf8-decode.js";

type CoreCodec="ascii"|"latin_1"|"utf_8";

/** Core native policy is shared by text conversions and _codecs. A recovery
 * adapter belongs to one operation, preserving lazy handler/exception caching.
 * ASCII/Latin-1 encode hard-code strict; UTF-8 encode and decoders look it up. */
export function encodeRuntimeCoreText(codec:CoreCodec,source:RuntimeValue,errors:string|ImmutableBytes,registry:RuntimeCodecRegistry,context:BuiltinInvocationContext|undefined):Uint8Array {
  const {meter}=registry,payload=runtimeStringPayload(source)!;
  if(codec==="utf_8"){
    const cached=registry.cachedUnicodeUtf8(source);
    if(cached!==undefined)return cached.toUint8Array(meter);
  }
  let recovery:RuntimeCodecRecovery|undefined;
  const callback:Utf8EncodeRecovery=error=>{
    if(context===undefined)throw Error("codec recovery requires an interpreter invocation context");
    return (recovery??=new RuntimeCodecRecovery(registry,errors,source,context)).encode(error);
  };
  const native=errors==="ignore"||errors==="replace"||errors==="backslashreplace"||errors==="xmlcharrefreplace"||errors==="surrogateescape"||(codec==="utf_8"?errors==="surrogatepass":errors==="strict");
  const policy:Utf8EncodeErrors|Utf8EncodeRecovery=native?errors as Utf8EncodeErrors:callback;
  try{return codec==="utf_8"?encodeUtf8(payload.value,policy,meter,callback):encodeSingleByte(payload.value,codec==="latin_1"?"latin-1":"ascii",policy,meter,undefined,callback);}
  catch(error){
    // Recovery already owns exception preparation and callback failures. A
    // native fault from those services must not start preparation a second time.
    if(recovery===undefined&&error instanceof PythonEncodeError&&context?.prepareException!==undefined){
      try{throw context.prepareException(error,{unicodeObject:source});}
      catch(failure){
        // Exception preparation can cross an explicit service boundary. A
        // return or ordinary failure must observe cancellation before escaping;
        // an existing fatal failure retains its identity without another check.
        if(!(failure instanceof ExecutionLimitError))meter.checkpoint();
        throw failure;
      }
    }
    throw error;
  }
}

export function decodeRuntimeCoreText(codec:CoreCodec,bytes:Uint8Array,errors:string|ImmutableBytes,final:boolean,registry:RuntimeCodecRegistry,context:BuiltinInvocationContext|undefined,nativeCString=false):ReturnType<typeof decodeUtf8> {
  const {meter,values}=registry;
  let recovery:RuntimeCodecRecovery|undefined;
  const callback:Utf8DecodeRecovery=error=>{
    if(context===undefined)throw Error("codec recovery requires an interpreter invocation context");
    return (recovery??=new RuntimeCodecRecovery(registry,errors,values.none,context)).decode(error);
  };
  const policy:Utf8DecodeErrors|Utf8DecodeRecovery=errors==="ignore"||errors==="replace"||errors==="surrogateescape"?errors:callback;
  return codec==="utf_8"?decodeUtf8(bytes,policy,meter,final,nativeCString):decodeSingleByte(bytes,codec==="latin_1"?"latin-1":"ascii",policy,meter);
}
