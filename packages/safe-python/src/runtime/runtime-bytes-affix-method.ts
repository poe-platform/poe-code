import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Tuple alternatives are checked lazily after bound conversion. Unlike byte
 * searches, these methods do not accept integer needles. */
export function createRuntimeBytesAffixMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: "startswith" | "endswith", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got 0`);
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `${name} expected at most 3 arguments, got ${positional.length}`);
      const start = runtimeSearchBound(positional[1], 0n, meter, true), stop = runtimeSearchBound(positional[2], 9223372036854775807n, meter, true);
      const candidate = positional[0], tuple = candidate.kind === "tuple";
      meter.checkpoint(1, 64);
      const matches = (value: RuntimeValue): boolean => {
        meter.checkpoint();
        if (value.kind !== "bytes") {
          const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
          throw new PythonRuntimeError("TypeError", tuple ? `a bytes-like object is required, not '${type}'` : `${name} first arg must be bytes or a tuple of bytes, not ${type}`);
        }
        return receiver.value.hasAffix(value.value, name === "startswith" ? "start" : "end", start, stop, meter);
      };
      if (!tuple) return values.boolean(matches(candidate));
      for (const value of candidate.items) if (matches(value)) return values.true;
      return values.false;
    }
  });
}
