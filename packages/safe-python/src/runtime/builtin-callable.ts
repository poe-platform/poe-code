import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeCallable, type CallabilityContext } from "./runtime-callability.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

/** Explicit registration of positional-only callable with the execution's
 * call-slot inspection policy. Never attempts a speculative guest invocation. */
export function createCallableBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: CallabilityContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "callable", invoke(positional, keywords, meter) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "callable() takes no keyword arguments");
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `callable() takes exactly one argument (${positional.length} given)`);
    return values.boolean(runtimeCallable(positional[0], meter, context));
  } });
}
