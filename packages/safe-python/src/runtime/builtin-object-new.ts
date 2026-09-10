import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { lookupMroAttribute } from "./class-attributes.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Canonical plain-object allocator for one registry. Slot identities distinguish
 * inherited object allocation/initialization from overrides. The registry must
 * validate abstract classes and complete native layout conflicts before exposure;
 * this allocator never invokes init or allocates incompatible native payloads. */
export function createObjectNewBuiltin(values: RuntimeValues, meter: ExecutionMeter, keys: KeyOperations<RuntimeValue>, objectType: TypeValue, owns: (type: TypeValue) => boolean): BuiltinFunctionValue {
  meter.checkpoint(1, 96);
  const newName = values.string("__new__"), initName = values.string("__init__");
  const builtin: BuiltinFunctionValue = values.builtinFunction({ name: "object.__new__", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (positional.length === 0) throw new PythonRuntimeError("TypeError", "object.__new__(): not enough arguments");
    const type = positional[0];
    if (type.kind !== "type") {
      const name = type.kind === "instance" ? type.type.value.name : type.kind === "cell" ? invocation?.typeName?.(type) ?? "cell" : type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind;
      meter.checkpoint();
      throw new PythonRuntimeError("TypeError", `object.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
    }
    const owned = owns(type); meter.checkpoint();
    if (!owned) throw Error("type is not owned by this object allocator");
    if (type.value.mro.length === 0) {
      meter.checkpoint(0, 128 + 2 * type.value.name.length);
      throw new PythonRuntimeError("TypeError", `cannot create '${type.value.name}' instances`);
    }
    if (!type.value.hasObjectLayout) {
      const name = type.value.name; meter.checkpoint(0, 128 + 4 * name.length);
      throw new PythonRuntimeError("TypeError", `object.__new__(${name}) is not safe, use ${name}.__new__()`);
    }
    if (positional.length > 1 || keywords.items.size !== 0) {
      const allocator = lookupMroAttribute(type.value.mro, newName, (owner, name) => owner.namespace.items.lookup(name), meter)?.value;
      if (allocator !== builtin) throw new PythonRuntimeError("TypeError", "object.__new__() takes exactly one argument (the type to instantiate)");
      const initializer = lookupMroAttribute(type.value.mro, initName, (owner, name) => owner.namespace.items.lookup(name), meter)?.value;
      const defaultInitializer = objectType.value.namespace.items.lookup(initName)?.value; meter.checkpoint();
      if (initializer === defaultInitializer) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(type.value.name, meter)}() takes no arguments`);
    }
    const dictionary = type.value.hasInstanceDictionary ? values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage)) : undefined;
    return values.instance(type, dictionary);
  } });
  return builtin;
}
