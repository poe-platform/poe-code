import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly in the execution's builtin namespace. Both adapters use
 * the caller's shared representation context so guest callbacks retain the same
 * container guards and default-object policy. str is a type, not this builtin
 * function family. All capabilities and values belong to the same execution. */
export function createRepresentationBuiltin(name: "repr" | "ascii", values: RuntimeValues, meter: ExecutionMeter, context: RepresentationContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${name}() takes no keyword arguments`);
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${name}() takes exactly one argument (${positional.length} given)`);
      return representationObject(positional[0], name, context, meter);
    }
  });
}
