import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";
import { runtimeLength } from "./runtime-length.js";

/** Register explicitly in an execution's builtin namespace. Exact containers
 * read their length without traversal or guest callbacks. Generic __len__ slots
 * remain part of the wider object model; values and capability share one meter.
 */
export function createLenBuiltin(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "len",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "len() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `len() takes exactly one argument (${positional.length} given)`);
      return values.integer(runtimeLength(positional[0], meter));
    }
  });
}
