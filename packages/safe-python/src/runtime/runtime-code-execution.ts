import {createFunctionState,type FunctionCreationContext} from "./function-state.js";
import type {CompiledFunction} from "./function-compilation.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {bindRuntimeCodeClosure} from "./runtime-closure-binding.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Execute callable compiler code as a fresh zero-argument activation. Original
 * function defaults are not properties of code objects. The ordinary runtime
 * call path owns argument errors, return values and suspended execution kinds.
 * Caller locals are deliberately not used as optimized function fast slots;
 * class suites instead execute directly in the supplied original namespace. */
export function executeRuntimeFunctionCode(code:CompiledFunction<RuntimeValue>,closure:Extract<RuntimeValue,{kind:"tuple"}>|undefined,context:Omit<FunctionCreationContext<RuntimeValue>,"closure">,values:RuntimeValues,meter:ExecutionMeter,invocation:Pick<BuiltinInvocationContext,"call"|"executeClassBody">,locals?:RuntimeValue):RuntimeValue {
  meter.checkpoint(1,192);
  try {
    const captured=bindRuntimeCodeClosure(code,closure,meter);
    const state=createFunctionState(code,new Map(),{...context,closure:captured},meter);
    state.closureObject=closure??values.none;
    if(code.body.kind==="class"){
      if(locals===undefined||invocation.executeClassBody===undefined)throw Error("class code execution requires a namespace and class-body policy");
      const cell=invocation.executeClassBody(values.function(state),locals);
      meter.checkpoint();return cell===undefined?values.none:values.cell(cell);
    }
    return invocation.call(values.function(state),[]);
  } finally {meter.checkpoint();}
}
