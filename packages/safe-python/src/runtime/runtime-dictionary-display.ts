import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionDictionary } from "./expression-evaluation.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { mergeRuntimeMappingProxy } from "./runtime-mapping-proxy.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";
import { mergeRuntimeMapping } from "./runtime-mapping-merge.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";

/** Literal builder, not dict(iterable): ** accepts mappings only. Exact maps
 * reuse cached hashes within a shared key-policy domain and share member values.
 * Active invocation capabilities enable guest mapping slots, without host
 * property lookup or iterable-pair fallback. Only AttributeError is translated.
 */
export function beginRuntimeDictionary(initial: readonly (readonly [RuntimeValue, RuntimeValue])[], values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): ExpressionDictionary<RuntimeValue> {
  meter.checkpoint(1, 128);
  let storage = runtimeDictionaryStorage;
  if (initial.length > 5) {
    let exactStrings = true;
    for (const [key] of initial) { meter.checkpoint(); if (key.kind !== "str") { exactStrings = false; break; } }
    meter.checkpoint(1, 64);
    storage = { ...runtimeDictionaryStorage, minimumEntries: initial.length, exactStrings };
  }
  const result = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, storage));
  const builder: ExpressionDictionary<RuntimeValue> = {
    set(key, value) {
      meter.checkpoint(1, 32);
      runtimeDictionaryAccess(result, key, { kind: "set", value }, meter);
    },
    update(mapping) {
      meter.checkpoint();
      try {
        if (mapping.kind === "dict") result.items.update(mapping.items);
        else if (mapping.kind === "mappingproxy") mergeRuntimeMappingProxy(result, mapping, meter);
        else mergeRuntimeMapping(result, mapping, values, meter, invocation, invocation?.iteration);
      } catch (error) {
        meter.checkpoint();
        if (!(error instanceof PythonRuntimeError) || error.name !== "AttributeError") throw error;
        const name = hasRuntimeInstanceAttributes(mapping) ? diagnosticTypeName(mapping.type.value.name, meter, 200)
          : mapping.kind === "none" ? "NoneType" : mapping.kind === "not-implemented" ? "NotImplementedType" : mapping.kind;
        throw new PythonRuntimeError("TypeError", `'${name}' object is not a mapping`);
      }
    },
    finish() { meter.checkpoint(); return result; }
  };
  for (const [key, value] of initial) builder.set(key, value);
  return builder;
}
