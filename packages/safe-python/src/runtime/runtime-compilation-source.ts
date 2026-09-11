import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";

/** Text/buffer branch of compile source conversion. AST objects must be handled
 * by the compiler backend before entering this branch. No __str__/__bytes__ or
 * iteration fallback participates. Buffer leases end before parsing starts.
 */
export function runtimeCompilationSource(source:RuntimeValue,meter:ExecutionMeter,context:Pick<BuiltinInvocationContext,"buffers"|"isException"|"prepareException">={}):string|Uint8Array {
  let lease:RuntimeBufferLease|undefined,fatal=false;
  try {
    meter.checkpoint();
    if(source.kind==="str"){
      meter.checkpoint(1,64+68*source.value.length);
      let text="";
      for(let index=0;index<source.value.length;index++){
        const point=source.value.codePointAt(BigInt(index),meter);
        if(point>=0xd800&&point<=0xdfff){
          let end=index+1;
          while(end<source.value.length){
            const next=source.value.codePointAt(BigInt(end),meter);
            if(next<0xd800||next>0xdfff)break;
            end++;
          }
          meter.checkpoint(0,320);
          const error=new PythonEncodeError("utf-8",source.value,index,end,"surrogates not allowed");
          if(context.prepareException!==undefined){
            meter.checkpoint(1,48);
            throw context.prepareException(error,{unicodeObject:source});
          }
          throw error;
        }
        text+=String.fromCodePoint(point);
      }
      return text;
    }
    if(source.kind==="bytes")return source.value.toUint8Array(meter);
    try {lease=context.buffers?.acquireSimple(source);}
    catch(error){
      if(error instanceof ExecutionLimitError||(!(error instanceof PythonRuntimeError)&&context.isException?.(error,"BaseException")!==true))throw error;
    }
    meter.checkpoint();
    if(lease===undefined){
      meter.checkpoint(0,320);
      throw new PythonRuntimeError("TypeError","compile() arg 1 must be a string, bytes or AST object");
    }
    return lease.copy().toUint8Array(meter);
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally {lease?.release();if(!fatal)meter.checkpoint();}
}
