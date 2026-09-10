import { lookupMroAttribute } from "./class-attributes.js";
import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { constructRuntimeFloat } from "./runtime-float-construction.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Exact float preserves exact inputs. Heap subtypes own distinct float storage
 * and optional dictionaries; ordinary type calls run their initializer later. */
export function createFloatNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, owns: (type: TypeValue) => boolean): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "float.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = invocation?.typeName?.(type) ?? (type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind);
        throw new PythonRuntimeError("TypeError", `float.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
      }
      if (!owns(type)) throw Error("type is not owned by this float allocator");
      let subtype = false;
      for (const ancestor of type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) { subtype = true; break; } }
      const name = diagnosticTypeName(type.value.name, meter);
      if (!subtype) throw new PythonRuntimeError("TypeError", `float.__new__(${name}): ${name} is not a subtype of float`);
      if (type.value.nativeStorage !== owner.value) throw new PythonRuntimeError("TypeError", `float.__new__(${name}) is not safe, use ${name}.__new__()`);
      meter.checkpoint(0, positional.length * 8);
      let conversionKeywords = keywords;
      if (type !== owner && keywords.items.size !== 0) {
        const initName = values.string("__init__");
        const initializer = lookupMroAttribute(type.value.mro, initName, (base, key) => base.namespace.items.lookup(key), meter)?.value;
        const defaultInitializer = lookupMroAttribute(owner.value.mro, initName, (base, key) => base.namespace.items.lookup(key), meter)?.value;
        if (initializer !== defaultInitializer) conversionKeywords = values.dictionary(owner.value.namespace.items.emptyCopy());
      }
      const result = constructRuntimeFloat(positional.slice(1), conversionKeywords, values, meter, { invocation, buffers: invocation?.buffers, byteArray: invocation?.bytes?.byteArray?.bind(invocation.bytes) });
      if (type === owner) return result;
      const dictionary = type.value.hasInstanceDictionary ? values.dictionary(owner.value.namespace.items.emptyCopy()) : undefined;
      return values.instance(type, dictionary, values.float(result.value));
    }
  });
}
