import type {ImmutableBytes} from "./immutable-bytes.js";
import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {encodeUtf8} from "./utf8-encode.js";
import type {BuiltinInvocationContext,DictionaryValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

const parameters=["encoding","errors"] as const;

/** Shared Argument Clinic binding for str.encode and bytes.decode. Validate the
 * names before empty-input shortcuts, preserving native string subtype storage. */
export function bindRuntimeCodecArguments(operation:"encode"|"decode",positional:readonly RuntimeValue[],keywords:DictionaryValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):readonly [string|ImmutableBytes,string|ImmutableBytes|undefined] {
  const count=positional.length+keywords.items.size;
  if(count>2)throw new PythonRuntimeError("TypeError",`${operation}() takes at most 2 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
  const args=bindRuntimeClinicArguments(operation,parameters,positional,keywords,values,meter,invocation);
  const names:(string|ImmutableBytes)[]=[];
  for(let index=0;index<2;index++){
    const value=args[index];if(value===undefined){names.push(index===0?"utf-8":"strict");continue;}
    const text=runtimeStringPayload(value);
    if(text===undefined){
      // Native diagnostics use the actual type, including iterator families
      // and metaclasses, without invoking guest attribute hooks.
      const type=value.kind==="none"?"None":invocation?.typeName?.(value)??(value.kind==="instance"?value.type.value.diagnosticName:value.kind==="not-implemented"?"NotImplementedType":value.kind);
      throw new PythonRuntimeError("TypeError",`${operation}() argument '${parameters[index]}' must be str, not ${diagnosticTypeName(type,meter,50)}`);
    }
    if(invocation?.codecs!==undefined){
      if(index===1){names.push(invocation.codecs.unicodeErrorPolicy(value,invocation));continue;}
      const bytes=invocation.codecs.unicodeUtf8(value,invocation);
      for(const byte of bytes){
        meter.checkpoint();
        if(byte===0){meter.checkpoint(0,192);throw new PythonRuntimeError("ValueError","embedded null character");}
      }
      names.push(bytes);continue;
    }
    let name="";
    for(const point of text.value){
      meter.checkpoint(1,64);
      if(point>=0xd800&&point<=0xdfff){
        try{encodeUtf8(text.value,"strict",meter);}catch(error){if(error instanceof PythonEncodeError&&invocation?.prepareException!==undefined)throw invocation.prepareException(error,{unicodeObject:value});throw error;}
      }
      name+=String.fromCodePoint(point);
    }
    if(name.includes("\0")){
      meter.checkpoint(0,192);
      throw new PythonRuntimeError("ValueError","embedded null character");
    }
    names.push(name);
  }
  // Omission reaches custom codecs as a missing argument, not explicit strict.
  return [names[0],args[1]===undefined?undefined:names[1]];
}
