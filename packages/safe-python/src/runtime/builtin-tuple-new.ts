import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { lookupMroAttribute } from "./class-attributes.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Exact allocation preserves exact inputs; subclasses own distinct backing
 * tuples and ordinary dictionaries. Iteration requests no hints or closing. */
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
      if (keywords.items.size !== 0) {
        const key = values.string("__init__");
        const actual = lookupMroAttribute(type.value.mro, key, (base, name) => base.namespace.items.lookup(name), meter)?.value;
        const inherited = lookupMroAttribute(owner.value.mro, key, (base, name) => base.namespace.items.lookup(name), meter)?.value;
        if (actual === inherited) throw new PythonRuntimeError("TypeError", "tuple() takes no keyword arguments");
      }
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `tuple expected at most 1 argument, got ${positional.length - 1}`);
      const source = positional[1];
      if (type === owner && source?.kind === "tuple") return source;
      const payload = source === undefined ? values.tuple([]) : source.kind === "tuple" ? values.tuple(source.items)
        : source.kind === "list" ? values.tuple(source.items.length, index => source.items.get(BigInt(index)))
          : values.tuple(collectIterator(runtimeIterate(source, values, meter, invocation?.iteration), meter));
      if (type === owner) return payload;
      const dictionary = type.value.hasInstanceDictionary ? values.dictionary(owner.value.namespace.items.emptyCopy()) : undefined;
      return values.instance(type, dictionary, payload);
    }
  });
}
