import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {ImmutableBytes} from "./immutable-bytes.js";
import type {RuntimeBufferLease} from "./runtime-buffer-context.js";
import type {RuntimeStringConstructionContext} from "./runtime-string-construction.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";
import {requireRuntimeTextCodecResult} from "./runtime-text-codec-result.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";

export type RuntimeTextDecoder=(bytes:ImmutableBytes,encoding:string|ImmutableBytes,errors:string|ImmutableBytes|undefined,meter:ExecutionMeter,invocation:BuiltinInvocationContext|undefined)=>RuntimeValue;

/** Bind string decoding to an execution-owned codec policy. Exact bytes already
 * own immutable storage; other buffers are copied while leased and stay pinned
 * until the decoder returns or throws. Empty inputs skip copying and codec
 * lookup. No iterable/__bytes__ fallback is used. */
export function createRuntimeStringDecoder(codec:RuntimeTextDecoder,values:RuntimeValues):NonNullable<RuntimeStringConstructionContext["decode"]> {
  return (source,encoding,errors,meter,invocation)=>{
    let lease:RuntimeBufferLease|undefined,fatal=false;
    try {
      meter.checkpoint(1,96);
      if(runtimeStringPayload(source)!==undefined)throw new PythonRuntimeError("TypeError","decoding str is not supported");
      let bytes:ImmutableBytes;
      const payload=runtimeBytesPayload(source);
      if(payload!==undefined)bytes=payload.value;
      else {
        lease=invocation?.buffers?.acquireSimple(source);meter.checkpoint();
        if(lease===undefined){
          const name=diagnosticTypeName(invocation?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind),meter);
          meter.checkpoint(0,192+2*name.length);
          throw new PythonRuntimeError("TypeError",`decoding to str: need a bytes-like object, ${name} found`);
        }
        if(lease.byteLength===0)return values.string("");
        bytes=lease.copy();meter.checkpoint();
      }
      if(bytes.length===0)return values.string("");
      const result=codec(bytes,encoding,errors,meter,invocation);
      requireRuntimeTextCodecResult(result,"decode",encoding,meter,invocation);
      // PyUnicode_Decode applies unicode_result after registry dispatch:
      // canonical empty/Latin-1 singletons, otherwise original subtype identity.
      const text=runtimeStringPayload(result)!.value;
      if(text.length===0||text.length===1&&text.codePointAt(0n,meter)<256)return values.stringPoints(text,"canonical");
      return result;
    } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{lease?.release();if(!fatal)meter.checkpoint();}
  };
}
