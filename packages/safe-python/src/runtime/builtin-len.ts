import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import type { LengthProtocolContext } from "./length-protocol.js";
import { runtimeLength } from "./runtime-length.js";
import { createRuntimeLengthContext } from "./runtime-length-context.js";

/** Register explicitly in an execution's builtin namespace. Exact containers
 * read their length without traversal or guest callbacks. Optional generic
 * __len__/__index__ dispatch shares the execution's meter and warning policy.
 */
export function createLenBuiltin(values: RuntimeValues, meter: ExecutionMeter, protocol?: LengthProtocolContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "len",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "len() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `len() takes exactly one argument (${positional.length} given)`);
      const length = protocol ?? (invocation === undefined ? undefined : createRuntimeLengthContext(invocation, meter));
      return values.integer(runtimeLength(positional[0], meter, length));
    }
  });
}
