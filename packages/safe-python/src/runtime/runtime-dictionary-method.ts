import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { updateRuntimeDictionary } from "./runtime-dictionary-update.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { BuiltinFunctionValue, DictionaryValue, MappingProxyValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Explicit exact-type read-method binding, not guest attribute discovery.
 * Returned capabilities retain the receiver's storage and validate calls before
 * lookup or allocation. Mutable dict methods and introspection are separate.
 */
export function createRuntimeDictionaryMethod(receiver: DictionaryValue | MappingProxyValue, name: "get" | "copy" | "keys" | "values" | "items" | "__reversed__", values: RuntimeValues, meter: ExecutionMeter, originalReceiver: RuntimeValue = receiver, bound = true): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const dictionary = receiver.kind === "dict" ? receiver : receiver.value;
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      const typeName = bound && originalReceiver.kind === "instance" ? originalReceiver.type.value.name : receiver.kind;
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(typeName, meter)}.${name}() takes no keyword arguments`);
      if (name === "get") {
        if (positional.length < 1) throw new PythonRuntimeError("TypeError", "get expected at least 1 argument, got 0");
        if (positional.length > 2) throw new PythonRuntimeError("TypeError", `get expected at most 2 arguments, got ${positional.length}`);
        if (receiver.kind === "mappingproxy" && receiver.value.kind !== "dict") {
          if (invocation?.attribute === undefined) throw Error("mapping proxy delegation requires attribute access");
          return invocation.call(invocation.attribute(receiver.value, name), [positional[0], positional[1] ?? values.none]);
        }
        if (dictionary.kind !== "dict") throw Error("native dictionary method requires dictionary storage");
        return runtimeDictionaryAccess(dictionary, positional[0], "lookup", meter)?.value ?? positional[1] ?? values.none;
      }
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(typeName, meter)}.${name}() takes no arguments (${positional.length} given)`);
      if (receiver.kind === "mappingproxy" && receiver.value.kind !== "dict") {
        if (invocation?.attribute === undefined) throw Error("mapping proxy delegation requires attribute access");
        return invocation.call(invocation.attribute(receiver.value, name), []);
      }
      if (dictionary.kind !== "dict") throw Error("native dictionary method requires dictionary storage");
      if (name === "copy") {
        if (originalReceiver.kind !== "instance") return values.dictionary(dictionary.items.copy());
        const result = values.dictionary(dictionary.items.emptyCopy());
        updateRuntimeDictionary(result, originalReceiver, values, meter, invocation);
        return result;
      }
      if (name === "__reversed__") {
        meter.checkpoint(1, 32);
        return values.iterator(dictionary.items.reversed(key => key));
      }
      return values.dictionaryView(dictionary, name === "keys" ? "dict_keys" : name === "values" ? "dict_values" : "dict_items", originalReceiver.kind === "instance" ? originalReceiver : undefined);
    }
  });
}
