import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { constructRange } from "./range-construction.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Canonical range allocation converts integer indices before retaining a lazy
 * arbitrary-precision progression. It never materializes the range's members. */
export function createRangeNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "range.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = invocation?.typeName?.(type) ?? (type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind);
        throw new PythonRuntimeError("TypeError", `range.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
      }
      if (type !== owner) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `range.__new__(${name}): ${name} is not a subtype of range`);
      }
      if (invocation?.integerIndex === undefined) throw Error("range allocation requires an integer index policy");
      meter.checkpoint(0, positional.length * 8);
      return values.range(constructRange(positional.slice(1), keywords.items, invocation.integerIndex, meter));
    }
  });
}
