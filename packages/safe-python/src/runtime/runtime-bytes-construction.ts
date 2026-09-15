import type {ImmutableBytes} from "./immutable-bytes.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError,exhaustAllocation,type ExecutionMeter} from "./execution-budget.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {validateIndexResult} from "./index-protocol.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {ProtocolIterator} from "./protocol-iterator.js";
import {nativeIteratorLengthHint} from "./native-iterator-length-hint.js";
import {unexpectedBuiltinKeyword} from "./unexpected-builtin-keyword.js";
import {encodeUtf8} from "./utf8-encode.js";
import {requireRuntimeTextCodecResult} from "./runtime-text-codec-result.js";
import type {RuntimeTextEncoder} from "./runtime-utf8-encoding.js";
import type {BuiltinInvocationContext,DictionaryValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

const parameters=["source","encoding","errors"] as const;
// CPython's release-build bytes writer uses inline storage up to this size.
// Finishing inline storage interns a single byte; a reserved heap buffer keeps
// its own identity even if callbacks shrink the eventual output to one byte.
const bytesWriterInlineCapacity=512n;

/** Native bytes conversion. Callback dispatch remains in the owning execution;
 * mutable buffers are copied, while __bytes__ results retain guest identity. */
export function constructRuntimeBytes(positional:readonly RuntimeValue[],keywords:DictionaryValue,values:RuntimeValues,meter:ExecutionMeter,encode:RuntimeTextEncoder,invocation?:BuiltinInvocationContext):RuntimeValue {
  let fatal=false;
  try {
    meter.checkpoint(1,192);
    const count=positional.length+keywords.items.size;
    if(count>3)throw new PythonRuntimeError("TypeError",`bytes() takes at most 3 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
    const args=[...positional];let remaining=keywords.items.size;
    // Unlike vectorcall methods, tp_new receives a dictionary. Parameter-order
    // dictionary lookups must preserve stored-key hash/equality and mutations.
    for(let index=positional.length;index<parameters.length&&remaining>0;index++){
      const found=keywords.items.lookup(values.string(parameters[index]));meter.checkpoint();
      if(found!==undefined){args[index]=found.value;remaining--;}
    }
    if(remaining>0){
      for(let index=0;index<positional.length;index++){
        const found=keywords.items.lookup(values.string(parameters[index]));meter.checkpoint();
        if(found!==undefined)throw new PythonRuntimeError("TypeError",`argument for bytes() given by name ('${parameters[index]}') and position (${index+1})`);
      }
      unexpectedBuiltinKeyword("bytes",keywords,parameters,values,meter,invocation);
    }
    const names:(string|ImmutableBytes)[]=[];
    for(let index=1;index<3;index++){
      const value=args[index];if(value===undefined){names.push(index===1?"utf-8":"strict");continue;}
      const text=runtimeStringPayload(value);
      if(text===undefined)throw new PythonRuntimeError("TypeError",`bytes() argument '${parameters[index]}' must be str, not ${diagnosticTypeName(value.kind==="none"?"None":invocation?.typeName?.(value)??value.kind,meter,50)}`);
      if(invocation?.codecs!==undefined){
        names.push(invocation.codecs.unicodeErrorPolicy(value,invocation));continue;
      }
      try{encodeUtf8(text.value,"strict",meter);}catch(error){if(error instanceof PythonEncodeError&&invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:value});throw error;}
      let name="";for(const point of text.value){meter.checkpoint(1,4);name+=String.fromCodePoint(point);}
      if(name.includes("\0"))throw new PythonRuntimeError("ValueError","embedded null character");
      names.push(name);
    }
    const source=args[0],text=source===undefined?undefined:runtimeStringPayload(source);
    if(args[1]!==undefined){
      if(text===undefined)throw new PythonRuntimeError("TypeError","encoding without a string argument");
      let result:RuntimeValue;
      try{result=encode(source!,names[0],args[2]===undefined?undefined:names[1],meter,invocation);}catch(error){if(error instanceof PythonEncodeError&&error.object===text.value&&invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:source!});throw error;}
      requireRuntimeTextCodecResult(result,"encode",names[0],meter,invocation);return result;
    }
    if(args[2]!==undefined)throw new PythonRuntimeError("TypeError",text===undefined?"errors without a string argument":"string argument without an encoding");
    if(source===undefined)return values.bytes(new Uint8Array());
    if(source.kind==="bytes")return source;
    const slot=source.kind==="instance"||source.kind==="type"?invocation?.lookupSpecial?.(source,"__bytes__"):undefined;meter.checkpoint();
    const method=slot===undefined?invocation?.bytes?.lookupBytes(source):()=>invocation!.call(slot,[]);
    if(method!==undefined){
      const result=method();meter.checkpoint();
      if(runtimeBytesPayload(result)!==undefined)return result;
      throw new PythonRuntimeError("TypeError",`__bytes__ returned non-bytes (type ${diagnosticTypeName(invocation?.typeName?.(result)??result.kind,meter)})`);
    }
    if(text!==undefined)throw new PythonRuntimeError("TypeError","string argument without an encoding");
    const index=invocation?.integerIndex;
    const direct=source.kind==="int"?source.value:source.kind==="bool"?source.value?1n:0n:index?.integer(source);
    let size=direct;
    try{
      const indexSlot=direct===undefined&&(source.kind==="instance"||source.kind==="type")?index?.lookupIndex(source):undefined;meter.checkpoint();
      if(indexSlot!==undefined)size=index!.integer(validateIndexResult(indexSlot(),index!,meter));
    }catch(error){if(!runtimeExceptionMatches(error,"TypeError",invocation))throw error;}
    if(size!==undefined){
      if(BigInt.asIntN(64,size)!==size)throw new PythonRuntimeError("OverflowError",`cannot fit '${diagnosticTypeName(invocation?.typeName?.(source)??source.kind,meter)}' into an index-sized integer`);
      if(size<0n)throw new PythonRuntimeError("ValueError","negative count");
      if(size>0x7ffffffffffffffen-32n)throw new PythonRuntimeError("OverflowError","byte string is too large");
      if(size>0xffffffffn)exhaustAllocation(meter);
      meter.checkpoint(0,Number(size));
      return values.bytes(new Uint8Array(Number(size)),size===0n?"canonical":"fresh");
    }
    const payload=runtimeBytesPayload(source);
    if(payload!==undefined)return values.bytes(payload.value,payload.value.length===0?"canonical":"fresh");
    const buffers=invocation?.buffers;
    const lease=buffers?.acquireFull===undefined?buffers?.acquireSimple(source):buffers.acquireFull(source);
    try{
      meter.checkpoint();
      if(lease!==undefined){const copied=lease.copy();meter.checkpoint();return values.bytes(copied,copied.length===0?"canonical":"fresh");}
    }finally{lease?.release();}
    const buffer=invocation?.bytes?.bufferBytes?.(source);meter.checkpoint();
    if(buffer!==undefined)return values.bytes(buffer,buffer.length===0?"canonical":"fresh");
    let iterator:Iterator<RuntimeValue>;
    try{iterator=runtimeIterate(source,values,meter,invocation?.iteration);}
    catch(error){if(!runtimeExceptionMatches(error,"TypeError",invocation))throw error;throw new PythonRuntimeError("TypeError",`cannot convert '${diagnosticTypeName(invocation?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind),meter)}' object to bytes`);}
    const reservation=source.kind==="list"||source.kind==="tuple"?BigInt(source.items.length)
      :iterator instanceof ProtocolIterator?iterator.lengthHint(64n,source):nativeIteratorLengthHint(iterator,meter,64n)??64n;
    if(reservation>0x7ffffffffffffffen-32n)throw new PythonRuntimeError("OverflowError","byte string is too large");
    if(reservation>0xffffffffn)exhaustAllocation(meter);
    meter.checkpoint(0,Number(reservation));
    const items:number[]=[];
    while(true){
      meter.checkpoint();const step=iterator.next();meter.checkpoint();if(step.done)break;
      const byte=runtimeIntegerIndex(step.value,meter,index);
      if(byte<0n||byte>255n)throw new PythonRuntimeError("ValueError","bytes must be in range(0, 256)");
      meter.checkpoint(0,8);items.push(Number(byte));
    }
    meter.checkpoint(0,items.length);
    return values.bytes(Uint8Array.from(items),items.length!==0&&(source.kind==="tuple"||reservation>bytesWriterInlineCapacity)?"fresh":"canonical");
  }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}
