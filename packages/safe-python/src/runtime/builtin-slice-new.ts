import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Allocation retains arbitrary components, including a zero step. Index
 * coercion and zero-step validation belong to consumers, not construction. */
export function createSliceNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "slice.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = invocation?.typeName?.(type) ?? (type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind);
        throw new PythonRuntimeError("TypeError", `slice.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
      }
      if (type !== owner) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `slice.__new__(${name}): ${name} is not a subtype of slice`);
      }
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "slice() takes no keyword arguments");
      const count = positional.length - 1;
      if (count === 0) throw new PythonRuntimeError("TypeError", "slice expected at least 1 argument, got 0");
      if (count > 3) throw new PythonRuntimeError("TypeError", `slice expected at most 3 arguments, got ${count}`);
      return values.slice(count === 1 ? { upper: positional[1] } : { lower: positional[1], upper: positional[2], step: positional[3] });
    }
  });
}
