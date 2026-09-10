import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {BuiltinFunctionValue,RuntimeValues} from "./runtime-values.js";
import {acquireRuntimeAsyncIterator,type RuntimeAsyncIteratorProtocol} from "./runtime-async-iterator-acquisition.js";

/** aiter is synchronous acquisition, not an await or a next operation. */
export function createAiterBuiltin(values:RuntimeValues,meter:ExecutionMeter,protocol?:RuntimeAsyncIteratorProtocol):BuiltinFunctionValue {
  meter.checkpoint(1,64);
  return values.builtinFunction({name:"aiter",invoke(positional,keywords,meter,invocation){
    meter.checkpoint();
    if(keywords.items.size)throw new PythonRuntimeError("TypeError","aiter() takes no keyword arguments");
    if(positional.length!==1)throw new PythonRuntimeError("TypeError",`aiter() takes exactly one argument (${positional.length} given)`);
    const context=protocol??invocation;
    if(context===undefined)throw Error("aiter requires an execution protocol capability");
    return acquireRuntimeAsyncIterator(positional[0],context,meter,"aiter");
  }});
}
