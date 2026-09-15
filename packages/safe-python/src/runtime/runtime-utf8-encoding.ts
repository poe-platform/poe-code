import type {ImmutableBytes} from "./immutable-bytes.js";
import {encodeRuntimeCoreText} from "./runtime-core-text-codec.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {unicodeCodecName} from "../unicode-codec-name.js";
import {encodeSingleByte} from "./single-byte-encode.js";
import type {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {displayRuntimeEncodingName,normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";
import {encodeUtf8,type Utf8EncodeErrors,type Utf8EncodeRecovery} from "./utf8-encode.js";
import {encodeUtf8Signature} from "./utf8-signature.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {unicodeTextCodecs} from "./runtime-unicode-text-codecs.js";
import {coreCodecAliases,runtimeTextCodecFastPaths,resolveCoreCodec} from "./runtime-core-codec-aliases.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {throwRuntimeCodecFailure} from "./runtime-codec-failure.js";

/** Extensions receive the original guest object, including native str subtypes.
 * Extract storage only inside a native codec, never before registry dispatch. */
export type RuntimeTextEncoder=(source:RuntimeValue,encoding:string|ImmutableBytes,errors:string|ImmutableBytes|undefined,meter:ExecutionMeter,invocation:BuiltinInvocationContext|undefined)=>RuntimeValue;

type TextCodec=(text:CodePointString,errors:Utf8EncodeErrors,meter:ExecutionMeter,recover?:Utf8EncodeRecovery)=>Uint8Array;
const codecs=new Map<string,TextCodec>();
const codecAliases=new Map<string,TextCodec>();
const freshEncoders=new Set(unicodeTextCodecs.filter(codec=>codec.freshEncodedBytes).map(codec=>codec.encode));
for(const [canonical,aliases,encode] of [
  ["utf_8",coreCodecAliases.utf_8,encodeUtf8],
  ["utf_8_sig",[],(text,errors,meter,recover)=>encodeUtf8Signature(text,recover!==undefined&&errors!=="ignore"&&errors!=="replace"&&errors!=="backslashreplace"&&errors!=="xmlcharrefreplace"&&errors!=="surrogateescape"&&errors!=="surrogatepass"?recover:errors,meter,recover)],
  ["ascii",coreCodecAliases.ascii,
    (text,errors,meter)=>encodeSingleByte(text,"ascii",errors,meter,point=>unicodeCodecName(point,meter))],
  ["latin_1",coreCodecAliases.latin_1,
    (text,errors,meter)=>encodeSingleByte(text,"latin-1",errors,meter,point=>unicodeCodecName(point,meter))],
  ...unicodeTextCodecs.map(({name,aliases,encode}):[string,readonly string[],TextCodec]=>[name,aliases,encode]),
] satisfies [string,readonly string[],TextCodec][]){
  codecs.set(canonical,encode);
  for(const alias of aliases){codecs.set(alias,encode);codecAliases.set(alias,encode);}
}
const handlers=new Set(["strict","ignore","replace","surrogateescape","surrogatepass","backslashreplace","xmlcharrefreplace","namereplace"]);

/** Shared native text dispatch with an explicit registry extension outside
 * native shortcut spellings and for custom error handlers. Codec lookup includes
 * empty input; error lookup remains lazy.
 * Returned bytes own their storage and never alias the source string. */
export function createRuntimeUtf8Encoder(values:RuntimeValues,fallback?:RuntimeTextEncoder):RuntimeTextEncoder {
  return (source,encoding,errors,meter,invocation)=>{
    let fatal=false,annotate=false;
    try {
      meter.checkpoint(1,96);
      const payload=runtimeStringPayload(source);
      if(payload===undefined)throw Error("text encoding requires native string storage");
      const name=normalizeRuntimeEncodingName(encoding,meter);
      meter.checkpoint(name.length,32+2*name.length);
      // Only CPython's native spelling shortcuts bypass the live registry.
      // Having a kernel available does not make a codec a text fast path.
      if(invocation?.codecs!==undefined&&!runtimeTextCodecFastPaths.has(name))return invocation.codecs.transform("encode",source,encoding,errors,invocation,true);
      if(fallback!==undefined&&!runtimeTextCodecFastPaths.has(name))return fallback(source,encoding,errors,meter,invocation);
      const core=resolveCoreCodec(name);
      if(core!==undefined&&invocation?.codecs!==undefined){
        return values.bytes(encodeRuntimeCoreText(core,source,errors??"strict",invocation.codecs,invocation));
      }
      // Dotted spellings may resolve aliases, but cannot import canonical modules.
      const codec=codecs.get(name)??codecAliases.get(name.replaceAll(".","_"));
      if(codec===undefined){
        if(fallback!==undefined)return fallback(source,encoding,errors,meter,invocation);
        // An empty search path can still have cached codecs: a callback may
        // unregister itself before returning a successful result. The registry
        // also owns the distinct empty-path diagnostic on a cache miss.
        if(invocation?.codecs!==undefined)return invocation.codecs.transform("encode",source,encoding,errors,invocation,true);
        meter.checkpoint(0,160+2*encoding.length);
        throw new PythonRuntimeError("LookupError",`unknown encoding: ${displayRuntimeEncodingName(encoding,meter)}`);
      }
      annotate=!runtimeTextCodecFastPaths.has(name);
      const policy=errors??"strict",known=typeof policy==="string"&&handlers.has(policy),handler=known?policy as Utf8EncodeErrors:"strict";
      let recovery:RuntimeCodecRecovery|undefined;
      const recover:Utf8EncodeRecovery|undefined=invocation?.codecs===undefined?undefined:error=>{
        recovery??=new RuntimeCodecRecovery(invocation.codecs!,policy,source,invocation);
        return recovery.encode(error);
      };
      try{
        const bytes=codec(payload.value,recover===undefined?handler:policy as Utf8EncodeErrors,meter,recover);
        return values.bytes(bytes,bytes.length!==0&&freshEncoders.has(codec)?"fresh":"canonical");
      }
      catch(error){
        // Once a handler operation starts, preserve its failure even when an
        // explicit service raises a native encoding fault. Do not retry it as
        // preparation or reinterpret it as a missing error handler.
        if(recovery!==undefined)throw error;
        if(error instanceof PythonEncodeError&&recover!==undefined&&invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:source});
        if(!(error instanceof PythonEncodeError)||known)throw error;
        if(fallback!==undefined){annotate=false;return fallback(source,encoding,errors,meter,invocation);}
        meter.checkpoint(0,192+2*policy.length);
        throw new PythonRuntimeError("LookupError",`unknown error handler name '${diagnosticTypeName(displayRuntimeEncodingName(policy,meter),meter,400)}'`);
      }
    } catch(error){
      try {
        if(annotate)throwRuntimeCodecFailure(error,"encode",encoding,meter,invocation);
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
