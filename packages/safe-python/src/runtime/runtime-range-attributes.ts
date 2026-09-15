import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { searchRange } from "./range-search.js";
import { createRuntimeSearchEquality } from "./runtime-search-equality.js";
import { RuntimeRangeIterator } from "./runtime-range-iterator.js";
import type { BuiltinInvocationContext, DictionaryValue, RangeValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact range members retain arbitrary-precision progression bounds. */
export function readRuntimeRangeAttribute(receiver: RangeValue, name: string, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue | undefined {
  meter.checkpoint();
  if (name === "start" || name === "stop" || name === "step") return receiver[name];
  if (name !== "count" && name !== "index" && name !== "__reversed__") return undefined;
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name,
    invoke(positional, keywords, meter, invocation) {
      return callRuntimeRangeMethod(receiver, name, positional, keywords, values, meter, invocation);
    }
  });
}

/** Shared methods use arithmetic for exact int/bool needles and element-first
 * guest equality for every other needle; no needle index conversion applies. */
export function callRuntimeRangeMethod(receiver: RangeValue, name: "count" | "index" | "__reversed__", positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `range.${name}() takes no keyword arguments`);
  if (name === "__reversed__") {
    if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `range.__reversed__() takes no arguments (${positional.length} given)`);
    return values.iterator(new RuntimeRangeIterator(receiver, true, values, meter));
  }
  if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `range.${name}() takes exactly one argument (${positional.length} given)`);
  const result = searchRange(name, receiver.value, positional[0], {
    exactInteger: value => value.kind === "int" ? value.value : value.kind === "bool" ? value.value ? 1n : 0n : undefined,
    integer: value => values.integer(value),
    equal: createRuntimeSearchEquality(values, meter, invocation)
  }, meter);
  return values.integer(result as bigint);
}
