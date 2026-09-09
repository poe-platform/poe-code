import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { rangeIndexOf } from "./integer-sequence.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { RangeValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact range members. Integer/bool searches use arithmetic regardless of
 * cardinality; other values retain the native exhaustive equality path. */
export function readRuntimeRangeAttribute(receiver: RangeValue, name: string, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue | undefined {
  meter.checkpoint();
  if (name === "start" || name === "stop" || name === "step") return values.integer(receiver.value[name]);
  if (name !== "count" && name !== "index") return undefined;
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `range.${name}() takes no keyword arguments`);
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
