import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { constructRuntimeFrozenSet } from "./runtime-frozenset.js";
import { lookupMroAttribute } from "./class-attributes.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Mutable sets defer consumption to init; frozen sets build during new and
 * preserve exact frozen input identity. Subclasses own dictionaries and slots
 * while retaining native storage behind ordinary guest protocol dispatch. */
export function createSetNewBuiltin(kind: "set" | "frozenset", owner: TypeValue, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, owns: (type: TypeValue) => boolean): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner: owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", `${kind}.__new__(): not enough arguments`);
      const type = positional[0];
      if (type.kind !== "type") {
        const name = diagnosticTypeName(invocation?.actualType?.(type).value.name ?? (type.kind === "instance" ? type.type.value.name : type.kind === "none" ? "NoneType" : type.kind), meter);
        throw new PythonRuntimeError("TypeError", `${kind}.__new__(X): X is not a type object (${name})`);
      }
      const owned = owns(type); meter.checkpoint();
      if (!owned) throw Error("type is not owned by this set allocator");
      let subtype = false;
      for (const ancestor of type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) { subtype = true; break; } }
      if (!subtype) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `${kind}.__new__(${name}): ${name} is not a subtype of ${kind}`);
      }
      let payload;
      if (kind === "set") payload = values.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
      else {
        let constructionKeywords = keywords;
        if (type !== owner && keywords.items.size !== 0) {
          const key = values.string("__init__");
          const actual = lookupMroAttribute(type.value.mro, key, (base, name) => base.namespace.items.lookup(name), meter)?.value;
          const inherited = lookupMroAttribute(owner.value.mro, key, (base, name) => base.namespace.items.lookup(name), meter)?.value;
          if (actual !== inherited) constructionKeywords = values.dictionary(keywords.items.emptyCopy());
        }
        meter.checkpoint(0, 16 + (positional.length - 1) * 8);
        payload = constructRuntimeFrozenSet(positional.slice(1), constructionKeywords, values, keys, meter, invocation?.iteration, type.value.name);
      }
      if (type === owner) return payload;
      const dictionary = type.value.hasInstanceDictionary ? values.dictionary(owner.value.namespace.items.emptyCopy()) : undefined;
      return values.instance(type, dictionary, payload);
    }
  });
}
