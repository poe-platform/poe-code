import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeTypePredicate} from "./runtime-type-predicate.js";
import type {BuiltinFunctionValue,BuiltinInvocationContext,RuntimeValues} from "./runtime-values.js";

export function createTypePredicateBuiltin(name:"isinstance"|"issubclass",values:RuntimeValues,meter:ExecutionMeter,context?:BuiltinInvocationContext):BuiltinFunctionValue {
  meter.checkpoint(0,64);
  return values.builtinFunction({name,invoke(positional,keywords,meter,invocation){
    meter.checkpoint();
    if(keywords.items.size)throw new PythonRuntimeError("TypeError",`${name}() takes no keyword arguments`);
    if(positional.length!==2)throw new PythonRuntimeError("TypeError",`${name} expected 2 arguments, got ${positional.length}`);
    return values.boolean(runtimeTypePredicate(name,positional[0],positional[1],meter,context??invocation));
  }});
}
