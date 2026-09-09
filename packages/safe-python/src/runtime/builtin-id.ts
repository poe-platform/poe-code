import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface IdentityContext {
  /** Stable, unique identity for each live guest object in this execution. */
  id(value: RuntimeValue): bigint;
}

/** Explicit id registration with execution-owned identities, never host memory
 * addresses. Validation precedes identity allocation or capability invocation. */
export function createIdBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: IdentityContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "id", invoke(positional, keywords, meter) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "id() takes no keyword arguments");
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `id() takes exactly one argument (${positional.length} given)`);
    const identity = context.id(positional[0]);
    meter.checkpoint();
    return values.integer(identity);
  } });
}
