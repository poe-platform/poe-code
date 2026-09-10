import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Exact tuple allocation preserves exact inputs and consumes other iterables
 * without length hints or implicit closing. Owned subclass storage is separate. */
export function createTupleNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, owns: (type: TypeValue) => boolean): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "tuple.__new__", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "tuple.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = diagnosticTypeName(invocation?.actualType?.(type).value.name ?? (type.kind === "instance" ? type.type.value.name : type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind), meter);
        throw new PythonRuntimeError("TypeError", `tuple.__new__(X): X is not a type object (${name})`);
      }
      const owned = owns(type); meter.checkpoint();
      if (!owned) throw Error("type is not owned by this tuple allocator");
      let subtype = false;
      for (const ancestor of type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) { subtype = true; break; } }
      if (!subtype) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `tuple.__new__(${name}): ${name} is not a subtype of tuple`);
      }
      if (type !== owner) throw Error("tuple subclass storage is not implemented");
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "tuple() takes no keyword arguments");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `tuple expected at most 1 argument, got ${positional.length - 1}`);
      if (positional.length === 1) return values.tuple([]);
      const source = positional[1];
      if (source.kind === "tuple") return source;
      if (source.kind === "list") return values.tuple(source.items.length, index => source.items.get(BigInt(index)));
      return values.tuple(collectIterator(runtimeIterate(source, values, meter, invocation?.iteration), meter));
    }
  });
}
