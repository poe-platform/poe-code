import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeHash, type RuntimeHashContext } from "./runtime-hash.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly with the same execution-wide identity/payload hash policy
 * used by dictionaries and sets. Guest type-level hash slots remain outside the
 * exact-value hashing kernel. No process-global seed or host hash is introduced. */
export function createHashBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: RuntimeHashContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "hash",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "hash() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `hash() takes exactly one argument (${positional.length} given)`);
      const result = runtimeHash(positional[0], context, meter);
      meter.checkpoint();
      return values.integer(result);
    }
  });
}
