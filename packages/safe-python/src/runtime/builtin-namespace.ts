import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** The execution owner supplies the current guest namespace policy; this never
 * discovers ambient host globals or infers a snapshot from a host call stack. */
export function createNamespaceBuiltin(name:"locals"|"globals",values:RuntimeValues,meter:ExecutionMeter,read:()=>RuntimeValue):BuiltinFunctionValue {
  meter.checkpoint(1,64);
  return values.builtinFunction({name,invoke(positional,keywords,meter){
    meter.checkpoint();
    try {
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${name}() takes no keyword arguments`);
      if(positional.length!==0)throw new PythonRuntimeError("TypeError",`${name}() takes no arguments (${positional.length} given)`);
      return read();
    } finally {meter.checkpoint();}
  }});
}
