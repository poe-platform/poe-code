import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** bool allocation returns one of the execution's existing singleton values;
 * truth conversion owns guest bool/length dispatch, never numeric conversion. */
export function createBooleanNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "bool.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = invocation?.typeName?.(type) ?? (type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind);
        throw new PythonRuntimeError("TypeError", `bool.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
      }
      if (type !== owner) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `bool.__new__(${name}): ${name} is not a subtype of bool`);
      }
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bool() takes no keyword arguments");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `bool expected at most 1 argument, got ${positional.length - 1}`);
      if (positional.length === 1) return values.false;
      const truth = invocation?.truth === undefined ? runtimeTruth(positional[1], meter) : invocation.truth(positional[1]);
      meter.checkpoint(); return values.boolean(truth);
    }
  });
}
