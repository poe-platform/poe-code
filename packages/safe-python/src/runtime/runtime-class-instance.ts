import type {ExecutionMeter} from "./execution-budget.js";
import type {ExpressionContext} from "./expression-evaluation.js";
import {runtimeRealClassInstance} from "./runtime-real-type-check.js";
import type {BuiltinInvocationContext,RuntimeValue,TypeValue} from "./runtime-values.js";

/** Class-only isinstance protocol. Exact identity precedes virtual checks;
 * ordinary __class__ participates only after real inheritance fails. Tuple and
 * union class specifications belong to the builtin's argument policy. */
export function runtimeClassInstance(subject:RuntimeValue,type:TypeValue,expressions:ExpressionContext<RuntimeValue>,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):boolean {
  if(!invocation?.actualType||!invocation.lookupSpecial||!invocation.objectType)throw Error("class instance checks require actual types and canonical object metadata");
  const actual=invocation.actualType(subject);meter.checkpoint();
  if(actual===type)return true;
  if(type.metaclass!==invocation.objectType.metaclass){
    const checker=invocation.lookupSpecial(type,"__instancecheck__");meter.checkpoint();
    if(checker!==undefined){const call=expressions.beginCall(checker);call.positional(subject);const result=call.invoke();meter.checkpoint();return expressions.truth(result);}
  }
  return runtimeRealClassInstance(subject,type,meter,invocation);
}
