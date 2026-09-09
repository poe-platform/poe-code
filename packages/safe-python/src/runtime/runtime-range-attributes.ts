import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { rangeIndexOf } from "./integer-sequence.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { createRuntimeRangeIterator } from "./runtime-range-iterator.js";
import type { RangeValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact range members. Integer/bool searches use arithmetic regardless of
 * cardinality; other values retain the native exhaustive equality path. */
export function readRuntimeRangeAttribute(receiver: RangeValue, name: string, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue | undefined {
  meter.checkpoint();
  if (name === "start" || name === "stop" || name === "step") return values.integer(receiver.value[name]);
  if (name !== "count" && name !== "index" && name !== "__reversed__") return undefined;
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `range.${name}() takes no keyword arguments`);
      if (name === "__reversed__") {
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `range.__reversed__() takes no arguments (${positional.length} given)`);
        return values.iterator(createRuntimeRangeIterator(receiver.value, true, values, meter));
      }
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `range.${name}() takes exactly one argument (${positional.length} given)`);
      const value = positional[0];
      if (value.kind === "int" || value.kind === "bool") {
        const index = rangeIndexOf(receiver.value, value.kind === "int" ? value.value : value.value ? 1n : 0n);
        if (name === "count") return values.integer(index === undefined ? 0 : 1);
        if (index === undefined) throw new PythonRuntimeError("ValueError", "range.index(x): x not in range");
        return values.integer(index);
      }
      const iterator = runtimeIterate(receiver, values, meter);
      let count = 0n, index = 0n;
      while (true) {
        meter.checkpoint();
        const item = iterator.next();
        meter.checkpoint();
        if (item.done) break;
        const matches = runtimeComparison("==", item.value, value, values, meter).value;
        meter.checkpoint();
        if (matches) {
          if (name === "index") {
            if (index > 9223372036854775807n) throw new PythonRuntimeError("OverflowError", "index exceeds C integer size");
            return values.integer(index);
          }
          if (count === 9223372036854775807n) throw new PythonRuntimeError("OverflowError", "count exceeds C integer size");
          count++;
        }
        if (name === "index") index++;
      }
      if (name === "index") throw new PythonRuntimeError("ValueError", "sequence.index(x): x not in sequence");
      return values.integer(count);
    }
  });
}
