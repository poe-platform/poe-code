import type { TupleConstant } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Search immutable tuple slots without copying them. Referenced mutable
 * members retain their normal equality behavior; identical members match
 * without equality dispatch. Guest index slots and subclasses remain external. */
export function createRuntimeTupleMethod(receiver: TupleConstant<RuntimeValue>, name: "count" | "index", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `tuple.${name}() takes no keyword arguments`);
      let start = 0n, stop = BigInt(receiver.items.length);
      if (name === "index") {
        if (positional.length < 1) throw new PythonRuntimeError("TypeError", "index expected at least 1 argument, got 0");
        if (positional.length > 3) throw new PythonRuntimeError("TypeError", `index expected at most 3 arguments, got ${positional.length}`);
        start = runtimeSearchBound(positional[1], 0n, meter);
        stop = runtimeSearchBound(positional[2], stop, meter);
        const length = BigInt(receiver.items.length);
        if (start < 0n) start += length;
        if (start < 0n) start = 0n;
        if (stop < 0n) stop += length;
        else if (stop > length) stop = length;
      } else if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `tuple.count() takes exactly one argument (${positional.length} given)`);
      const value = positional[0], end = Number(stop);
      let count = 0;
      for (let index = Number(start); index < end; index++) {
        meter.checkpoint();
        const stored = receiver.items[index];
        const matches = stored === value || runtimeComparison("==", stored, value, values, meter).value;
        meter.checkpoint();
        if (matches) {
          if (name === "index") return values.integer(index);
          count++;
        }
      }
      if (name === "index") throw new PythonRuntimeError("ValueError", "tuple.index(x): x not in tuple");
      return values.integer(count);
    }
  });
}
