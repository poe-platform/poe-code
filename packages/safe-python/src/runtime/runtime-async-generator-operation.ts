import {AsyncGeneratorSend} from "./async-generator-send.js";
import {AsyncGeneratorThrow} from "./async-generator-throw.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {GeneratorRequest} from "./generator-execution.js";
import type {RuntimeAsyncGeneratorState} from "./runtime-generator-state.js";
import {RuntimeGeneratorThrowRequest} from "./runtime-generator-throw-request.js";
import type {RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Shared native policy for send and termination operations. Request validation
 * runs inside operation ownership; delegated throws retain their raw arguments. */
export function createRuntimeAsyncGeneratorOperation(state:RuntimeAsyncGeneratorState,request:GeneratorRequest<RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter):AsyncGeneratorSend<RuntimeValue>|AsyncGeneratorThrow<RuntimeValue> {
  const {execution,exceptions}=state;
  meter.checkpoint(0,256);
  const body={
    get phase(){return execution.phase;},
    get delegating(){return execution.delegating;},
    resume(input:GeneratorRequest<RuntimeValue>) {
      if(input.kind==="throw"&&input.error instanceof RuntimeGeneratorThrowRequest) {
        const args=input.error.arguments,invocation=input.error.invocation;
        if(args.length<1)throw new PythonRuntimeError("TypeError","throw expected at least 1 argument, got 0");
        if(args.length>3)throw new PythonRuntimeError("TypeError",`throw expected at most 3 arguments, got ${args.length}`);
        if(args.length>1&&input.error.warnLegacy)invocation.warn?.("DeprecationWarning","the (type, exc, tb) signature of throw() is deprecated, use the single-arg signature instead.");
        meter.checkpoint();
        if(!execution.delegating) {
          if(args.length===3&&args[2].kind!=="none")throw new PythonRuntimeError("TypeError","throw() third argument must be a traceback object");
          input={...input,error:exceptions.throwError(args[0],args[1]??values.none,invocation)};
        }
      }
      return execution.resume(input);
    }
  };
  const context={none:values.none,generatorExit:()=>exceptions.signal("GeneratorExit"),isGeneratorExit:(error:unknown)=>exceptions.matches(error,"GeneratorExit"),isStopAsyncIteration:(error:unknown)=>exceptions.matches(error,"StopAsyncIteration"),exhausted:()=>exceptions.signal("StopAsyncIteration")};
  if(request.kind==="send")return new AsyncGeneratorSend(body,state.activity,context,request.value,meter);
  const initial=request.kind==="close"?undefined:()=>{
    if(request.error instanceof RuntimeGeneratorThrowRequest) {
      const count=request.error.arguments.length;
      if(count<1)throw new PythonRuntimeError("TypeError","athrow expected at least 1 argument, got 0");
      if(count>3)throw new PythonRuntimeError("TypeError",`athrow expected at most 3 arguments, got ${count}`);
    }
    return request.error;
  };
  return new AsyncGeneratorThrow(body,state.activity,context,initial,meter);
}
