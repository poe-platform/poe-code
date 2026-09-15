import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeAbstractBases,runtimeAbstractSubclass} from "./runtime-abstract-class.js";
import type {BuiltinInvocationContext,RuntimeValue,TypeValue} from "./runtime-values.js";

/** Default instance policy, deliberately bypassing metaclass virtual checks. */
export function runtimeRealClassInstance(subject:RuntimeValue,type:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):boolean {
  if(!invocation?.attribute)throw Error("real instance checks require an attribute policy");
  let actual:TypeValue|undefined;
  if(type.kind==="type"){
    if(!invocation.actualType)throw Error("real instance checks require an actual type policy");
    try{actual=invocation.actualType(subject);}finally{meter.checkpoint();}
    for(const base of actual.value.mro){meter.checkpoint();if(base===type.value)return true;}
  }else if(runtimeAbstractBases(type,meter,invocation)===undefined)throw new PythonRuntimeError("TypeError","isinstance() arg 2 must be a type, a tuple of types, or a union");
  let apparent:RuntimeValue;
  try{apparent=invocation.attribute(subject,"__class__");}
  catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return false;throw error;}
  finally{meter.checkpoint();}
  if(type.kind!=="type")return runtimeAbstractSubclass(apparent,type,meter,invocation);
  if(apparent.kind!=="type"||apparent===actual)return false;
  for(const base of apparent.value.mro){meter.checkpoint();if(base===type.value)return true;}
  return false;
}

/** Real types use their MRO. Abstract class-like objects use ordered __bases__
 * traversal, including repeated reads and tuple-subclass storage. An explicit
 * work stack avoids host recursion; cyclic graphs remain bounded by the meter. */
export function runtimeRealClassSubclass(derived:RuntimeValue,type:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):boolean {
  if(derived.kind==="type"&&type.kind==="type"){
    for(const base of derived.value.mro){meter.checkpoint();if(base===type.value)return true;}
    return false;
  }
  if(runtimeAbstractBases(derived,meter,invocation)===undefined)throw new PythonRuntimeError("TypeError","issubclass() arg 1 must be a class");
  if(runtimeAbstractBases(type,meter,invocation)===undefined)throw new PythonRuntimeError("TypeError","issubclass() arg 2 must be a class, a tuple of classes, or a union");
  return runtimeAbstractSubclass(derived,type,meter,invocation);
}
