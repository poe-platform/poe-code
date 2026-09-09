import type { ExecutionMeter } from "./execution-budget.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import type { DictionaryValue, MappingProxyValue, RuntimeValue } from "./runtime-values.js";

/** Mapping expansion is not an exact-dict cached-hash merge. Capture keys first,
 * then check duplicates (for calls), fetch each current value and insert it.
 * Earlier writes and callback effects survive a later failed lookup/insertion.
 */
export function mergeRuntimeMappingProxy(target: DictionaryValue, source: MappingProxyValue, meter: ExecutionMeter, rejectDuplicate?: (key: RuntimeValue) => never): void {
  meter.checkpoint(1, 32);
  const keys = collectIterator(source.value.items.iterate(key => key), meter);
  for (const key of keys) {
    meter.checkpoint();
    if (rejectDuplicate && runtimeDictionaryAccess(target, key, "contains", meter)) rejectDuplicate(key);
    const value = runtimeDictionaryAccess(source.value, key, "get", meter);
    runtimeDictionaryAccess(target, key, { kind: "set", value }, meter);
  }
  meter.checkpoint();
}
