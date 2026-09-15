import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface ThrowNormalizationContext<Value> {
  isInstance(value:Value):boolean;
  isNone(value:Value):boolean;
  typeOf(value:Value):Value;
  typeName(type:Value):string;
  isSubclass(type:Value,requested:Value):boolean;
  tupleItems(value:Value):readonly Value[]|undefined;
  call(type:Value,args:readonly Value[]):Value;
  repr(value:Value):string;
  /** Convert a catchable failure to a native exception instance. Fatal host and
   * execution-limit failures must propagate, never become injected exceptions. */
  failure(error:unknown):Value;
}

/** Normalize the class form of generator.throw. Constructor/subclass failures
 * replace the injected exception, unlike invalid arguments to throw itself.
 * None means no constructor args; native tuples expand without guest iteration.
 * A mismatched constructor result receives the final restore construction.
 * This normalization does not add raise-statement normalization notes. */
export function normalizeThrownException<Value>(requested:Value,value:Value,context:ThrowNormalizationContext<Value>,meter:ExecutionMeter):Value {
  meter.checkpoint(0,64);
  const construct=(type:Value,input:Value):Value=>{
    meter.checkpoint(0,8);
    const args=context.isNone(input)?[]:context.tupleItems(input)??[input];
    const result=context.call(type,args);
    meter.checkpoint();
    if(!context.isInstance(result))throw new PythonRuntimeError("TypeError",`calling ${context.repr(type)} should have returned an instance of BaseException, not ${context.typeName(context.typeOf(result))}`);
    return result;
  };
  let failures=0;
  while(true) {
    meter.checkpoint();
    try {
      const actual=context.isInstance(value)?context.typeOf(value):undefined;
      if(actual!==undefined&&context.isSubclass(actual,requested)){requested=actual;break;}
      value=construct(requested,value);
      break;
    } catch(error) {
      value=context.failure(error);
      if(++failures===32)value=context.failure(new PythonRuntimeError("RecursionError","maximum recursion depth exceeded while normalizing an exception"));
      // A trusted failure policy must use the execution's canonical exception
      // classes. Still bound a broken policy without a host recursion overflow.
      if(failures>33)throw Error("exception normalization could not recover");
      requested=context.typeOf(value);
    }
  }
  if(context.typeOf(value)!==requested) {
    try {value=construct(requested,value);}
    catch(error){value=context.failure(error);}
  }
  return value;
}
