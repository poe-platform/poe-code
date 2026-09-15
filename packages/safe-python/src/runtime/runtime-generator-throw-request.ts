import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeGeneratorState } from "./runtime-generator-state.js";
import type { BuiltinInvocationContext, RuntimeValue,RuntimeValues } from "./runtime-values.js";

/** Host-only raw throw request. Delegated iterators see the supplied argument
 * list before exception/traceback validation or constructor invocation. */
export class RuntimeGeneratorThrowRequest {
  readonly arguments:readonly RuntimeValue[];
  constructor(arguments_:readonly RuntimeValue[],readonly invocation:BuiltinInvocationContext,meter:ExecutionMeter,readonly warnLegacy=true) {
    meter.checkpoint(1,72+8*arguments_.length);
    this.arguments=Object.freeze(arguments_.slice());Object.freeze(this);
  }
}

/** Execute a validated one-to-three-argument throw. Public descriptors own the
 * legacy warning; recursive native delegation must not emit it again. */
export function throwRuntimeGenerator(state:RuntimeGeneratorState,args:readonly RuntimeValue[],invocation:BuiltinInvocationContext,values:RuntimeValues,meter:ExecutionMeter,closeDelegate=true):RuntimeValue {
  meter.checkpoint();
  const error=state.execution.delegating?new RuntimeGeneratorThrowRequest(args,invocation,meter):state.exceptions.throwError(args[0],args[1]??values.none,invocation,args[2]);
  const result=state.execution.resume({kind:"throw",error,closeDelegate});
  if(result.done)throw state.exceptions.completion(result.value);
  return result.value;
}
