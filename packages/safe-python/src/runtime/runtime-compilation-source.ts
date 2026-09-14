import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";

/** Text/buffer branch of compile/eval/exec source conversion. AST/code objects
 * must be handled by the backend before entering this branch. No __str__/__bytes__
 * or iteration fallback participates. Buffer leases end before parsing starts.
 * Eval strips only initial ASCII space/tab after validating the original text.
 */
export function runtimeCompilationSource(source:RuntimeValue,meter:ExecutionMeter,context:Pick<BuiltinInvocationContext,"buffers"|"isException"|"prepareException">={},mode:"compile"|"eval"|"exec"="compile"):string|Uint8Array {
  let lease:RuntimeBufferLease|undefined,fatal=false;
  try {
    meter.checkpoint();
    const textPayload=runtimeStringPayload(source);
    if(textPayload!==undefined){
      meter.checkpoint(1,64+68*textPayload.value.length);
      let text="";
      for(let index=0;index<textPayload.value.length;index++){
        const point=textPayload.value.codePointAt(BigInt(index),meter);
        if(point>=0xd800&&point<=0xdfff){
          let end=index+1;
          while(end<textPayload.value.length){
            const next=textPayload.value.codePointAt(BigInt(end),meter);
            if(next<0xd800||next>0xdfff)break;
            end++;
          }
          meter.checkpoint(0,320);
          const error=new PythonEncodeError("utf-8",textPayload.value,index,end,"surrogates not allowed");
          if(context.prepareException!==undefined){
            meter.checkpoint(1,48);
            throw context.prepareException(error,{unicodeObject:source});
          }
          throw error;
        }
        text+=String.fromCodePoint(point);
      }
      return normalizeSource(text,mode,meter);
    }
    const bytesPayload=runtimeBytesPayload(source);
    if(bytesPayload!==undefined)return normalizeSource(bytesPayload.value.toUint8Array(meter),mode,meter);
    try {lease=context.buffers?.acquireSimple(source);}
    catch(error){
      if(error instanceof ExecutionLimitError||(!(error instanceof PythonRuntimeError)&&context.isException?.(error,"BaseException")!==true))throw error;
    }
    meter.checkpoint();
    if(lease===undefined){
      meter.checkpoint(0,320);
      throw new PythonRuntimeError("TypeError",`${mode}() arg 1 must be a string, bytes or ${mode==="compile"?"AST":"code"} object`);
    }
    return normalizeSource(lease.copy().toUint8Array(meter),mode,meter);
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally {lease?.release();if(!fatal)meter.checkpoint();}
}

function normalizeSource(source:string|Uint8Array,mode:"compile"|"eval"|"exec",meter:ExecutionMeter):string|Uint8Array {
  // _Py_SourceAsString rejects embedded NUL before tokenizer/codec dispatch.
  // This is a plain SyntaxError, without parser-owned filename or positions.
  // Text has already crossed the strict UTF-8 boundary, so surrogate failures
  // retain precedence even when a NUL occurred earlier in the source.
  for(let index=0;index<source.length;index++){
    meter.checkpoint();
    if((typeof source==="string"?source.charCodeAt(index):source[index])===0){
      meter.checkpoint(0,320);
      throw new PythonRuntimeError("SyntaxError","source code string cannot contain null bytes");
    }
  }
  if(mode!=="eval")return source;
  let start=0;
  while(start<source.length){
    meter.checkpoint();
    const unit=typeof source==="string"?source.charCodeAt(start):source[start];
    if(unit!==32&&unit!==9)break;
    start++;
  }
  if(start===0)return source;
  meter.checkpoint(1,64+(typeof source==="string"?2*(source.length-start):0));
  return typeof source==="string"?source.slice(start):source.subarray(start);
}
