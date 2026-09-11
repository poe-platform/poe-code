import type {ExecutionMeter} from "./execution-budget.js";
import {prepareRuntimeContextManager} from "./runtime-context-manager.js";
import type {PreparedAsyncContextManager} from "./statement-execution.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Preparation binds both methods synchronously; calls and await acquisition
 * happen only when the statement cursor advances entry/exit. Guest suspension
 * uses the owning coroutine's delegation, never host Promise capabilities. */
export function prepareRuntimeAsyncContextManager(source:RuntimeValue,invocation:BuiltinInvocationContext,awaitValue:(value:RuntimeValue,method:"aenter"|"aexit")=>Generator<RuntimeValue,RuntimeValue,RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter):PreparedAsyncContextManager<RuntimeValue> {
  meter.checkpoint(1,192);
  const manager=prepareRuntimeContextManager(source,invocation,values,meter,true);
  return {
    *enter(){meter.checkpoint(1,192);try{return yield* awaitValue(manager.enter(),"aenter");}finally{meter.checkpoint();}},
    *exit(exception){meter.checkpoint(1,192);try{return yield* awaitValue(manager.exit(exception),"aexit");}finally{meter.checkpoint();}}
  };
}
