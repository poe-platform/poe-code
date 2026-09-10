import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface AllAnyContext {
  iteration?: IterationContext<RuntimeValue>;
  /** Execution-owned truth dispatch, including guest __bool__/__len__ slots. */
  truth?(value: RuntimeValue): boolean;
}

/** Eager, short-circuiting reductions. Exhaustion metadata is consumed only
 * from next(); truth failures propagate unchanged. Explicit pulls avoid host
 * iterator closing on early exit, which Python does not request here. */
export function createAllAnyBuiltin(name: "all" | "any", values: RuntimeValues, meter: ExecutionMeter, context: AllAnyContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const decisive = name === "any";
  return values.builtinFunction({ name, invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${name}() takes no keyword arguments`);
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${name}() takes exactly one argument (${positional.length} given)`);
    const cursor = runtimeIterate(positional[0], values, meter, context.iteration ?? invocation?.iteration);
    for (;;) {
      meter.checkpoint();
      const item = cursor.next();
      meter.checkpoint();
      if (item.done) return values.boolean(!decisive);
      const truth = context.truth !== undefined ? context.truth(item.value)
        : invocation?.truth !== undefined ? invocation.truth(item.value) : runtimeTruth(item.value, meter);
      meter.checkpoint();
      if (truth === decisive) return values.boolean(decisive);
    }
  } });
}
