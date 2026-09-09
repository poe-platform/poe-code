import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionDictionary } from "./expression-evaluation.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { mergeRuntimeMappingProxy } from "./runtime-mapping-proxy.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Literal builder, not dict(iterable): ** accepts mappings only. Exact maps
 * reuse cached hashes within a shared key-policy domain and share member values.
 * Future guest mapping slots belong in the extensible expression hook; no host
 * object property lookup or iterable-pair fallback is performed implicitly.
 */
export function beginRuntimeDictionary(initial: readonly (readonly [RuntimeValue, RuntimeValue])[], values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter): ExpressionDictionary<RuntimeValue> {
  meter.checkpoint(1, 128);
  const result = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const builder: ExpressionDictionary<RuntimeValue> = {
    set(key, value) {
      meter.checkpoint(1, 32);
      runtimeDictionaryAccess(result, key, { kind: "set", value }, meter);
    },
    update(mapping) {
      meter.checkpoint();
      if (mapping.kind !== "dict" && mapping.kind !== "mappingproxy") {
        const name = mapping.kind === "none" ? "NoneType" : mapping.kind === "not-implemented" ? "NotImplementedType" : mapping.kind;
        throw new PythonRuntimeError("TypeError", `'${name}' object is not a mapping`);
      }
      if (mapping.kind === "mappingproxy") mergeRuntimeMappingProxy(result, mapping, meter);
      else result.items.update(mapping.items);
    },
    finish() { meter.checkpoint(); return result; }
  };
  for (const [key, value] of initial) builder.set(key, value);
  return builder;
}
