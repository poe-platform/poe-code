import type {ImmutableBytes} from "./immutable-bytes.js";
import {displayRuntimeEncodingName} from "./runtime-encoding-name.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";

/** Text consumers accept native subtypes but reject arbitrary codec results.
 * General codecs.encode/decode deliberately do not impose this restriction.
 * Inspect native storage without invoking __str__, __bytes__ or buffer slots.
 * The decoding consumer separately canonicalizes empty/Latin-1 singletons. */
export function requireRuntimeTextCodecResult(result:RuntimeValue,operation:"encode"|"decode",encoding:string|ImmutableBytes,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):void {
  meter.checkpoint();
  const payload=result.kind==="instance"?result.native:result;
  if(payload?.kind===(operation==="encode"?"bytes":"str"))return;
  // Exact text/byte tags already identify their immutable native type. Reading
  // their C-style type name does not need a separately published type object.
  const type=result.kind==="bytes"||result.kind==="str"?result.kind:invocation?.typeName?.(result)??(result.kind==="instance"?result.type.value.diagnosticName:result.kind==="none"?"NoneType":result.kind==="not-implemented"?"NotImplementedType":result.kind);
  const name=displayRuntimeEncodingName(encoding,meter,400),actual=diagnosticTypeName(type,meter,400);
  meter.checkpoint(1,320+2*(name.length+actual.length));
  throw new PythonRuntimeError("TypeError",`'${name}' ${operation}r returned '${actual}' instead of '${operation==="encode"?"bytes":"str"}'; use codecs.${operation}() to ${operation} to arbitrary types`);
}
