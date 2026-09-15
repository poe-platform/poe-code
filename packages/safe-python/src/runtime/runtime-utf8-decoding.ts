import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import type {RuntimeTextDecoder} from "./runtime-string-decoding.js";
import type {RuntimeValues,BuiltinInvocationContext} from "./runtime-values.js";
import {displayRuntimeEncodingName,normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import {decodeUtf8,type Utf8DecodeErrors,type Utf8Decoded,type Utf8DecodeRecovery} from "./utf8-decode.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {decodeUtf8Signature} from "./utf8-signature.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {unicodeTextCodecs} from "./runtime-unicode-text-codecs.js";
import {coreCodecAliases,runtimeTextCodecFastPaths} from "./runtime-core-codec-aliases.js";
import {throwRuntimeCodecFailure} from "./runtime-codec-failure.js";

const aliases=coreCodecAliases.utf_8;
type TextCodec=(bytes:Uint8Array,errors:Utf8DecodeErrors,meter:ExecutionMeter,invocation?:BuiltinInvocationContext,recover?:Utf8DecodeRecovery)=>Utf8Decoded;
const utf8:TextCodec=(bytes,errors,meter,_invocation,recover)=>decodeUtf8(bytes,recover!==undefined&&errors!=="ignore"&&errors!=="replace"&&errors!=="surrogateescape"?recover:errors,meter);
const codecs=new Map<string,TextCodec>(["utf_8",...aliases].map(name=>[name,utf8]));
const codecAliases=new Map<string,TextCodec>([...aliases].map(name=>[name,utf8]));
codecs.set("utf_8_sig",(bytes,errors,meter,_invocation,recover)=>decodeUtf8Signature(bytes,recover!==undefined&&errors!=="ignore"&&errors!=="replace"&&errors!=="surrogateescape"?recover:errors,meter));
for(const {name,aliases,decode} of unicodeTextCodecs){
  codecs.set(name,decode);
  for(const alias of aliases){codecs.set(alias,decode);codecAliases.set(alias,decode);}
}
const handlers=new Set(["strict","ignore","replace","surrogateescape","surrogatepass","backslashreplace"]);

/** Native Unicode text codecs with an explicit registry extension outside
 * native shortcut spellings and for custom error handlers. Error-handler lookup
 * is lazy: valid input accepts unknown names. Empty input skips codec lookup. */
export function createRuntimeUtf8Decoder(values:RuntimeValues,fallback?:RuntimeTextDecoder):RuntimeTextDecoder {
  return (bytes,encoding,errors,meter,invocation)=>{
    let fatal=false,annotate=false;
    try {
      meter.checkpoint(1,96);
      if(bytes.length===0)return values.string("");
      const name=normalizeRuntimeEncodingName(encoding,meter);
      meter.checkpoint(name.length,32+name.length*2);
      // Kernel availability does not bypass the interpreter's search path.
      // Only native text shortcut spellings avoid the supplied registry.
      if(fallback!==undefined&&!runtimeTextCodecFastPaths.has(name))return fallback(bytes,encoding,errors,meter,invocation);
      const decode=codecs.get(name)??codecAliases.get(name.replaceAll(".","_"));
      if(decode===undefined){
        if(fallback!==undefined)return fallback(bytes,encoding,errors,meter,invocation);
        meter.checkpoint(0,160+2*encoding.length);
        throw new PythonRuntimeError("LookupError",`unknown encoding: ${displayRuntimeEncodingName(encoding,meter)}`);
      }
      annotate=!runtimeTextCodecFastPaths.has(name);
      const policy=errors??"strict",known=typeof policy==="string"&&handlers.has(policy);
      let recovery:RuntimeCodecRecovery|undefined;
      const recover:Utf8DecodeRecovery|undefined=invocation?.codecs===undefined?undefined:error=>{
        recovery??=new RuntimeCodecRecovery(invocation.codecs!,policy,values.none,invocation);
        return recovery.decode(error);
      };
      // Preserve the requested name: some standard codecs validate their own
      // policy eagerly. Native Unicode kernels raise on unknown names only
      // at a decoding fault, where the registry fallback below still applies.
      try{return values.stringPoints(decode(bytes.toUint8Array(meter),policy as Utf8DecodeErrors,meter,invocation,recover).text);}
      catch(error){
        // Once registry recovery starts, its failures belong to that operation.
        // A service can raise a native decoding fault too; neither reinterpret
        // it as a missing handler nor execute the codec a second time.
        if(!(error instanceof PythonDecodeError)||known||recovery!==undefined)throw error;
        if(fallback!==undefined){annotate=false;return fallback(bytes,encoding,errors,meter,invocation);}
        if(policy==="xmlcharrefreplace"||policy==="namereplace")throw new PythonRuntimeError("TypeError","don't know how to handle UnicodeDecodeError in error callback");
        meter.checkpoint(0,192+2*policy.length);
        throw new PythonRuntimeError("LookupError",`unknown error handler name '${diagnosticTypeName(displayRuntimeEncodingName(policy,meter),meter,400)}'`);
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
