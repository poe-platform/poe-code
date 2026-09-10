import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Dictionary allocation ignores initialization arguments and creates fresh,
 * empty storage. Only types owned by the current registry may be allocated. */
export function createDictionaryNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, owns: (type: TypeValue) => boolean): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "dict.__new__", keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, _keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "dict.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = diagnosticTypeName(invocation?.actualType?.(type).value.name ?? (type.kind === "instance" ? type.type.value.name : type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind), meter);
        throw new PythonRuntimeError("TypeError", `dict.__new__(X): X is not a type object (${name})`);
      }
      const owned = owns(type); meter.checkpoint();
      if (!owned) throw Error("type is not owned by this dictionary allocator");
      let subtype = false;
      for (const ancestor of type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) { subtype = true; break; } }
      if (!subtype) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `dict.__new__(${name}): ${name} is not a subtype of dict`);
      }
      const payload = values.dictionary(owner.value.namespace.items.emptyCopy());
      if (type === owner) return payload;
      const dictionary = type.value.hasInstanceDictionary ? values.dictionary(owner.value.namespace.items.emptyCopy()) : undefined;
      return values.instance(type, dictionary, payload);
    }
  });
}
