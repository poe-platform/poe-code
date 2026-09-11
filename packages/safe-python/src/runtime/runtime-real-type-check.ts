import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import type {BuiltinInvocationContext,RuntimeValue,TypeValue} from "./runtime-values.js";

/** Default instance policy, deliberately bypassing metaclass virtual checks. */
export function runtimeRealClassInstance(subject:RuntimeValue,type:TypeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):boolean {
  if(!invocation?.actualType||!invocation.attribute)throw Error("real instance checks require actual type and attribute policies");
  let actual:TypeValue;
  try{actual=invocation.actualType(subject);}finally{meter.checkpoint();}
  for(const base of actual.value.mro){meter.checkpoint();if(base===type.value)return true;}
  let apparent:RuntimeValue;
  try{apparent=invocation.attribute(subject,"__class__");}
  catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return false;throw error;}
  finally{meter.checkpoint();}
  if(apparent.kind!=="type"||apparent===actual)return false;
  for(const base of apparent.value.mro){meter.checkpoint();if(base===type.value)return true;}
  return false;
}

/** Real types use their MRO. Abstract class-like objects use ordered __bases__
 * traversal, including repeated reads and tuple-subclass storage. An explicit
 * work stack avoids host recursion; cyclic graphs remain bounded by the meter. */
export function runtimeRealClassSubclass(derived:RuntimeValue,type:TypeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):boolean {
  if(derived.kind==="type"){
    for(const base of derived.value.mro){meter.checkpoint();if(base===type.value)return true;}
    return false;
  }
  if(!invocation?.attribute)throw Error("abstract subclass checks require an attribute policy");
  meter.checkpoint(0,96);
  const bases=(value:RuntimeValue)=>{
    let result:RuntimeValue;
    try{result=invocation.attribute!(value,"__bases__");}
    catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return undefined;throw error;}
    finally{meter.checkpoint();}
    return runtimeTuplePayload(result);
  };
  if(bases(derived)===undefined)throw new PythonRuntimeError("TypeError","issubclass() arg 1 must be a class");
  if(bases(type)===undefined)throw new PythonRuntimeError("TypeError","issubclass() arg 2 must be a class, a tuple of classes, or a union");
  const work:RuntimeValue[]=[derived];
  while(work.length){
    meter.checkpoint();let current=work.pop()!;
    for(;;){
      meter.checkpoint();if(current===type)return true;
      const found=bases(current);if(found===undefined||found.items.length===0)break;
      if(found.items.length===1){current=found.items[0];continue;}
      for(let index=found.items.length-1;index>=0;index--){meter.checkpoint(1,8);work.push(found.items[index]);}
      break;
    }
  }
  return false;
}
