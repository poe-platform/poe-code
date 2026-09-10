import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { updateDictionaryPairs } from "./dictionary-update.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { mergeRuntimeMappingProxy } from "./runtime-mapping-proxy.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { mergeRuntimeMapping } from "./runtime-mapping-merge.js";
import { ProtocolIterator } from "./protocol-iterator.js";
import { nativeIteratorLengthHint } from "./native-iterator-length-hint.js";

/** Exact-value update, after call binding. Dictionary sources share cached
 * hashes where possible; other current values use iterable pairs. Each row is
 * materialized before insertion, but previous writes survive later failures.
 * Exact list rows copy slots without invoking guest callbacks. Optional active
 * invocation capabilities enable mapping lookup and guest iterable rows.
 */
export function updateRuntimeDictionary(target: DictionaryValue, source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeValues["none"] {
  meter.checkpoint();
  if (source.kind === "dict") target.items.update(source.items);
  else if (source.kind === "mappingproxy") mergeRuntimeMappingProxy(target, source, meter);
  else {
    let mapping = false;
    if (invocation?.attribute !== undefined) {
      try { invocation.attribute(source, "keys"); mapping = true; }
      catch (error) {
        meter.checkpoint();
        if (!(error instanceof PythonRuntimeError) || error.name !== "AttributeError") throw error;
      }
      meter.checkpoint();
    }
    if (mapping) {
      mergeRuntimeMapping(target, source, values, meter, invocation, invocation?.iteration);
      return values.none;
    }
    const iterator = runtimeIterate(source, values, meter, invocation?.iteration);
    meter.checkpoint(0, 192);
    updateDictionaryPairs(iterator, {
      sequence: row => row.kind === "tuple" ? row.items : row.kind === "list" ? row.items.snapshot() : undefined,
      iterate: row => runtimeIterate(row, values, meter, invocation?.iteration),
      prepare(iterator) {
        meter.checkpoint();
        if (iterator instanceof ProtocolIterator) {
          const cursor = iterator.reacquire(); iterator.lengthHint(8n); return cursor;
        }
        nativeIteratorLengthHint(iterator, meter); return iterator;
      },
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
export function constructRuntimeDictionary(positional: readonly RuntimeValue[], keywords: ReadonlyMap<string, RuntimeValue>, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): DictionaryValue {
  meter.checkpoint();
  if (positional.length > 1) throw new PythonRuntimeError("TypeError", `dict expected at most 1 argument, got ${positional.length}`);
  const result = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage));
  if (positional.length === 1) updateRuntimeDictionary(result, positional[0], values, meter, invocation);
  for (const [name, value] of keywords) {
    meter.checkpoint(1, 32);
    runtimeDictionaryAccess(result, values.string(name), { kind: "set", value }, meter);
  }
  meter.checkpoint();
  return result;
}
