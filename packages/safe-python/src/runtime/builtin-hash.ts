import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeHash, type RuntimeHashContext } from "./runtime-hash.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly with the same execution-wide identity/payload hash policy
 * used by dictionaries and sets, including optional guest type-level hash slots.
 * No process-global seed or host hash is introduced. */
export function createHashBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: RuntimeHashContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "hash",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "hash() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `hash() takes exactly one argument (${positional.length} given)`);
      let result: bigint;
      try { result = runtimeHash(positional[0], context, meter); }
      catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
      meter.checkpoint();
      return values.integer(result);
    }
  });
}
