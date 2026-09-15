import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Frame snapshots are owned by the namespace implementation; object lookup
 * uses the full guest attribute protocol, including descriptors and overrides. */
export function createVarsBuiltin(values: RuntimeValues, meter: ExecutionMeter, locals: () => RuntimeValue): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "vars", invoke(args, kwargs, meter, invocation) {
    meter.checkpoint();
    if (kwargs.items.size) throw new PythonRuntimeError("TypeError", "vars() takes no keyword arguments");
    if (args.length > 1) throw new PythonRuntimeError("TypeError", `vars expected at most 1 argument, got ${args.length}`);
    if (args.length === 0) {
      try { return locals(); }
      finally { meter.checkpoint(); }
    }
    if (!invocation?.attribute) throw new Error("vars requires an execution attribute capability");
    try {
      const result = invocation.attribute(args[0], "__dict__");
      meter.checkpoint();
      return result;
    } catch (error) {
      meter.checkpoint();
      if (error instanceof ExecutionLimitError || !runtimeExceptionMatches(error, "AttributeError", invocation)) throw error;
      throw new PythonRuntimeError("TypeError", "vars() argument must have __dict__ attribute");
    }
  } });
}
