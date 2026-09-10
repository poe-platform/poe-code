import { lookupMroAttribute } from "./class-attributes.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Dictionary copies bypass mapping overrides only while the native iteration
 * slot is inherited. Inspect raw slots without binding guest descriptors. */
export function runtimeDictionaryCopySource(source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): DictionaryValue | undefined {
  const payload = runtimeDictionaryPayload(source);
  if (payload === undefined || source.kind === "dict") return payload;
  if (source.kind !== "instance" || invocation?.actualType === undefined) return undefined;
  const native = invocation.actualType(payload); meter.checkpoint();
  const name = values.string("__iter__");
  const inherited = lookupMroAttribute(source.type.value.mro, name, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
  return inherited === native.value.namespace.items.lookup(name)?.value ? payload : undefined;
}
