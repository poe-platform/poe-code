import {createFunctionState,type FunctionCreationContext} from "./function-state.js";
import type {CompiledFunction} from "./function-compilation.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {bindRuntimeCodeClosure} from "./runtime-closure-binding.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Execute function/lambda code as a fresh zero-argument activation. Original
 * function defaults are not properties of code objects. The ordinary runtime
 * call path owns argument errors, return values and suspended execution kinds.
 * Caller locals are deliberately not used as optimized function fast slots. */
export function executeRuntimeFunctionCode(code:CompiledFunction<RuntimeValue>,closure:Extract<RuntimeValue,{kind:"tuple"}>|undefined,context:Omit<FunctionCreationContext<RuntimeValue>,"closure">,values:RuntimeValues,meter:ExecutionMeter,invocation:Pick<BuiltinInvocationContext,"call">):RuntimeValue {
  meter.checkpoint(1,192);
  try {
    if(code.body.kind==="class")throw Error("function code execution does not accept synthetic class wrappers");
    const captured=bindRuntimeCodeClosure(code,closure,meter);
    const state=createFunctionState(code,new Map(),{...context,closure:captured},meter);
    return invocation.call(values.function(state),[]);
  } finally {meter.checkpoint();}
}
