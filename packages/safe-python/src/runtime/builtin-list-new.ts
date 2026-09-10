import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Exact native allocation creates empty storage without consuming init args.
 * Native subclass payload/state integration is not yet implemented. */
export function createListNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, owns: (type: TypeValue) => boolean): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "list.__new__", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, _keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "list.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = diagnosticTypeName(invocation?.actualType?.(type).value.name ?? (type.kind === "instance" ? type.type.value.name : type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind), meter);
        throw new PythonRuntimeError("TypeError", `list.__new__(X): X is not a type object (${name})`);
      }
      const owned = owns(type); meter.checkpoint();
      if (!owned) throw Error("type is not owned by this list allocator");
      let subtype = false;
      for (const ancestor of type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) { subtype = true; break; } }
      if (!subtype) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `list.__new__(${name}): ${name} is not a subtype of list`);
      }
      if (type !== owner) throw Error("native list subclass storage is not implemented");
      return values.list([]);
    }
  });
}
