import type { ExecutionMeter } from "./execution-budget.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import type { BuiltinInvocationContext, DictionaryValue, MappingProxyValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { mergeRuntimeMapping } from "./runtime-mapping-merge.js";

/** Mapping expansion is not an exact-dict cached-hash merge. Capture keys first,
 * then check duplicates (for calls), fetch each current value and insert it.
 * Earlier writes and callback effects survive a later failed lookup/insertion.
 */
export function mergeRuntimeMappingProxy(target: DictionaryValue, source: MappingProxyValue, meter: ExecutionMeter, rejectDuplicate?: (key: RuntimeValue) => never, context?: { readonly values: RuntimeValues; readonly invocation?: BuiltinInvocationContext }): void {
  meter.checkpoint(1, 32);
  if (source.value.kind !== "dict") {
    if (context === undefined) throw Error("mapping proxy expansion requires an execution context");
    mergeRuntimeMapping(target, source, context.values, meter, context.invocation, context.invocation?.iteration, rejectDuplicate);
    return;
  }
  const keys = collectIterator(source.value.items.iterate(key => key), meter);
  for (const key of keys) {
    meter.checkpoint();
    if (rejectDuplicate && runtimeDictionaryAccess(target, key, "contains", meter)) rejectDuplicate(key);
    const value = runtimeDictionaryAccess(source.value, key, "get", meter);
    runtimeDictionaryAccess(target, key, { kind: "set", value }, meter);
  }
  meter.checkpoint();
}
