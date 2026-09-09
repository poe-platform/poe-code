import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { updateDictionaryPairs } from "./dictionary-update.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { mergeRuntimeMappingProxy } from "./runtime-mapping-proxy.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact-value update, after call binding. Dictionary sources share cached
 * hashes where possible; other current values use iterable pairs. Each row is
 * materialized before insertion, but previous writes survive later failures.
 * Exact list rows copy slots without invoking guest callbacks. Iterator records
 * are already adapted; guest keys/length-hint slots need the wider object model.
 */
export function updateRuntimeDictionary(target: DictionaryValue, source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValues["none"] {
  meter.checkpoint();
  if (source.kind === "dict") target.items.update(source.items);
  else if (source.kind === "mappingproxy") mergeRuntimeMappingProxy(target, source, meter);
  else {
    const iterator = runtimeIterate(source, values, meter);
    meter.checkpoint(0, 192);
    updateDictionaryPairs(iterator, {
      sequence: row => row.kind === "tuple" ? row.items : row.kind === "list" ? row.items.snapshot() : undefined,
      iterate: row => runtimeIterate(row, values, meter),
      prepare(iterator) { meter.checkpoint(); return iterator; },
      isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError",
      set(key, value) {
        meter.checkpoint(1, 32);
        runtimeDictionaryAccess(target, key, { kind: "set", value }, meter);
      }
    }, meter);
  }
  meter.checkpoint();
  return values.none;
}

/** Expanded exact dict() calls. Call assembly already rejects duplicate or
 * non-string keyword names. Positional failure prevents all keyword insertion;
 * valid keywords overwrite positional entries without moving their first keys.
 * Guest builtin registration and subclass construction remain separate.
 */
export function constructRuntimeDictionary(positional: readonly RuntimeValue[], keywords: ReadonlyMap<string, RuntimeValue>, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter): DictionaryValue {
  meter.checkpoint();
  if (positional.length > 1) throw new PythonRuntimeError("TypeError", `dict expected at most 1 argument, got ${positional.length}`);
  const result = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  if (positional.length === 1) updateRuntimeDictionary(result, positional[0], values, meter);
  for (const [name, value] of keywords) {
    meter.checkpoint(1, 32);
    runtimeDictionaryAccess(result, values.string(name), { kind: "set", value }, meter);
  }
  meter.checkpoint();
  return result;
}
