import {compileCodeLocalLayout} from "./code-local-layout.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {CompiledFunction} from "./function-compilation.js";
import type {KeyOperations} from "./ordered-key-map.js";
import {bindRuntimeCodeClosure} from "./runtime-closure-binding.js";
import {runtimeFunctionClosure} from "./runtime-function-closure.js";
import {runtimeFunctionDefaults} from "./runtime-function-defaults.js";
import type {BuiltinInvocationContext,FunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Prepare all allocations before replacing executable state. Cells bind by
 * position, not their original names; metadata and default objects stay owned
 * by the existing function. Active frames retain the old compiled code. */
export function replaceRuntimeFunctionCode(fn:FunctionValue,code:CompiledFunction<RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter,keys?:KeyOperations<RuntimeValue>,warn?:BuiltinInvocationContext["warn"]):void {
  meter.checkpoint();
  try {
    const state=fn.value;
    const oldCount=(state.code.localLayout??compileCodeLocalLayout(state.code.scope,meter)).freeNames.length;
    const newCount=(code.localLayout??compileCodeLocalLayout(code.scope,meter)).freeNames.length;
    if(oldCount!==newCount){
      if(state.name.kind!=="str")throw Error("function name requires string storage");
      let name="";for(const point of state.name.value){meter.checkpoint(1,point>0xffff?4:2);name+=String.fromCodePoint(point);}
      throw new PythonRuntimeError("ValueError",`${name}() requires a code object with ${oldCount} free vars, not ${newCount}`);
    }
    if(state.code.kind!==code.kind){
      warn?.("DeprecationWarning","Assigning a code object of non-matching type is deprecated (e.g., from a generator to a plain function)");
      meter.checkpoint();
    }
    const original=runtimeFunctionClosure(fn,values,meter);
    if(original.kind!=="tuple"&&original.kind!=="none")throw Error("invalid function closure storage");
    const closure=bindRuntimeCodeClosure(code,original.kind==="tuple"?original:undefined,meter);
    runtimeFunctionDefaults(fn,"__defaults__",values,meter,keys);
    runtimeFunctionDefaults(fn,"__kwdefaults__",values,meter,keys);
    meter.checkpoint();state.code=code;state.closure=closure;
  } finally {meter.checkpoint();}
}
