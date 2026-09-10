import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** NoneType allocation always returns the execution's existing None singleton. */
export function createNoneNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner, keywordValidation: "callee",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "NoneType.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = invocation?.typeName?.(type) ?? (type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind);
        throw new PythonRuntimeError("TypeError", `NoneType.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
      }
      if (type !== owner) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `NoneType.__new__(${name}): ${name} is not a subtype of NoneType`);
      }
      if (positional.length !== 1 || keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "NoneType takes no arguments");
      return values.none;
    }
  });
}
