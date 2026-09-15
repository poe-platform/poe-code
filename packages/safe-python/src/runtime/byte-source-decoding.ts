import {detectSourceEncoding} from "../source-encoding.js";
import {PythonSyntaxError} from "../source.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {standardExceptionCatalog,type StandardExceptionName} from "./standard-exception-catalog.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {decodeUtf8,type Utf8DecodeRecovery} from "./utf8-decode.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {resolveCoreCodec,runtimeTextCodecFastPaths} from "./runtime-core-codec-aliases.js";
import {normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import {sourceUtf8Error} from "./source-utf8-error.js";
import {sourceDecoderResult} from "./source-decoder-result.js";
import {CodePointString} from "./code-point-string.js";
import {PythonUnicodeMessageError,PythonUnicodeSyntaxError} from "./unicode-message-error.js";

/** Codec search capability for names outside the native text fast paths,
 * including aliases of native codecs. Input is an owned byte-source snapshot.
 * Return undefined for an unknown codec. Guest text must retain its individual
 * code points: use CodePointString instead of a lossy UTF-16 round trip.
 * Implementations own their work and
 * output allocation charges; no filesystem or host codec is implicitly loaded.
 */
export type SourceByteDecoder=(encoding:string,source:Uint8Array,meter:ExecutionMeter)=>string|CodePointString|undefined;

/** Decode bytes before parsing, without treating coding comments in str input
 * as active declarations. Strict failures remain catchable Python syntax errors.
 */
export function decodeByteSource(source:Uint8Array,filename:string,meter:ExecutionMeter,decode?:SourceByteDecoder,mode:"exec"|"eval"="exec",sourceException?:(error:unknown)=>never,recover?:Utf8DecodeRecovery):string {
  let fatal=false;
  try {
    meter.checkpoint(1,129+source.length);
    const buffer=new Uint8Array(source.length+1);
    let written=0;
    for(let index=0;index<source.length;index++){
      meter.checkpoint();
      const byte=source[index];
      if(byte===0){meter.checkpoint(0,320);throw new PythonSyntaxError("source code string cannot contain null bytes",filename,{offset:0,line:1,column:0});}
      // The string tokenizer translates universal newlines before both its
      // encoding-cookie scan and codec dispatch, including codec fault offsets.
      buffer[written++]=byte===13?10:byte;
      if(byte===13&&source[index+1]===10)index++;
    }
    const snapshot=buffer.subarray(0,written);
    const {encoding,bomLength}=detectSourceEncoding(snapshot,{filename,meter,mode});
    meter.checkpoint(1,96+68*encoding.length);
    const normalized=normalizeRuntimeEncodingName(encoding,meter);
    // Preserve an initial BOM in decoded text: PythonSource consumes it exactly
    // once. Removing it here too would incorrectly accept two initial BOMs.
    const codec=resolveCoreCodec(normalized);
    let input=snapshot;
    // Alias availability is not a native shortcut. An installed search service
    // owns non-fast-path names, including misses after registry unregistration.
    if(codec===undefined||decode!==undefined&&!runtimeTextCodecFastPaths.has(normalized)){
      // The parser accounts for an implicit final newline on the native path.
      // A decoder callback observes the tokenizer's translated byte buffer,
      // so that newline must be materialized before crossing this boundary.
      if(mode==="exec"&&written!==0&&buffer[written-1]!==10)buffer[written++]=10;
      const result=decode?.(encoding,buffer.subarray(0,written),meter);
      meter.checkpoint();
      if(result!==undefined){
        if(typeof result!=="string"&&!(result instanceof CodePointString))throw new TypeError("source codec must return text or undefined");
        return sourceDecoderResult(result,filename,meter);
      }
      meter.checkpoint(0,320+2*encoding.length);
      throw new PythonSyntaxError(`unknown encoding: ${encoding}`,filename,{offset:0,line:0,column:-2});
    }
    // Codec conversion sees the string tokenizer's final LF even when native
    // alias dispatch avoids registry lookup. A partial UTF-8 sequence before
    // that LF is an invalid continuation, not an unexpected end of input.
    // Canonical UTF-8 uses tokenizer validation instead of codec conversion.
    const finalNewline=encoding!=="utf-8"&&mode==="exec"&&written!==0&&buffer[written-1]!==10;
    if(finalNewline){buffer[written]=10;input=buffer.subarray(0,written+1);}
    if(encoding!=="utf-8"&&recover!==undefined){
      // Unlike canonical UTF-8 tokenizer validation, native codec conversion
      // resolves strict through the interpreter's error-handler registry.
      const result=codec==="utf_8"?decodeUtf8(input,recover,meter,true):decodeSingleByte(input,codec==="ascii"?"ascii":"latin-1",recover,meter);
      meter.checkpoint();
      return sourceDecoderResult(result.text,filename,meter);
    }
    meter.checkpoint(1,128+68*input.length);
    let points:Iterable<number>;
    try{points=codec==="utf_8"?decodeUtf8(input,"strict",meter).text:input;}
    catch(error){
      // Only the tokenizer's canonical UTF-8 path uses this diagnostic.
      // Aliases such as utf8 perform codec conversion and keep its error text.
      if(encoding==="utf-8"&&error instanceof PythonDecodeError)throw sourceUtf8Error(input,error.start,bomLength,filename,meter);
      throw error;
    }
    let text="";
    let index=0;
    for(const point of points){
      meter.checkpoint();
      if(codec==="ascii"&&point>127)throw new PythonDecodeError("ascii",input,index,index+1,"ordinal not in range(128)",meter);
      text+=String.fromCodePoint(point);index++;
    }
    // PythonSource already owns the native path's implicit final newline.
    // Keep its source representation unchanged after successful conversion.
    if(finalNewline){meter.checkpoint(1,32+2*(text.length-1));return text.slice(0,-1);}
    return text;
  } catch(error){
    fatal=error instanceof ExecutionLimitError;
    if(!fatal&&sourceException!==undefined){
      meter.checkpoint();
      try{return sourceException(error);}
      catch(failure){fatal=failure instanceof ExecutionLimitError;throw failure;}
    }
    // Package-owned native faults carry their builtin exception identity.
    // Follow the same catalog ancestry as guest type construction; an ambient
    // Error name must never grant it Python exception semantics.
    if(error instanceof PythonRuntimeError){
      let name=error.name;
      while(Object.hasOwn(standardExceptionCatalog,name)){
        meter.checkpoint();
        if(name==="ValueError"||name==="LookupError"){
          let message=error.message;
          let messagePoints=error instanceof PythonUnicodeMessageError?error.messagePoints:undefined;
          const spec=standardExceptionCatalog[error.name as StandardExceptionName];
          if("stringArgument" in spec&&spec.stringArgument==="repr"&&error.argumentMessage!==undefined){
            const quoted=(messagePoints??CodePointString.fromString(error.argumentMessage,meter)).repr(false,meter);
            if(messagePoints!==undefined)messagePoints=quoted;
            meter.checkpoint(0,32+4*quoted.length);
            message="";
            for(const point of quoted){meter.checkpoint();message+=String.fromCodePoint(point);}
          }
          meter.checkpoint(0,320+2*message.length);
          if(messagePoints!==undefined)throw new PythonUnicodeSyntaxError(message,filename,{offset:0,line:0,column:-2},messagePoints);
          throw new PythonSyntaxError(message,filename,{offset:0,line:0,column:-2});
        }
        name=standardExceptionCatalog[name as StandardExceptionName].base;
      }
    }
    throw error;
  } finally {if(!fatal)meter.checkpoint();}
}
