import type { ExecutionMeter } from "./execution-budget.js";
import { linearizeMro } from "./mro.js";
import { lookupMroAttribute } from "./class-attributes.js";
import type { ClassAttribute } from "./instance-attributes.js";
import { resolveRuntimeClassAttribute, type RuntimeDescriptorContext } from "./runtime-descriptor.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Immutable inheritance metadata with an owned, live namespace. The class
 * builder supplies explicit bases (including object) and prepares the namespace.
 * This is not a guest type value; metaclass policy and mutable __bases__ belong
 * to class construction and the object layer.
 */
export class RuntimeTypeLayout {
  readonly name: string;
  readonly bases: readonly RuntimeTypeLayout[];
  readonly mro: readonly RuntimeTypeLayout[];
  readonly namespace: DictionaryValue;

  constructor(name: string, bases: readonly RuntimeTypeLayout[], namespace: DictionaryValue, meter: ExecutionMeter) {
    meter.checkpoint(1, 96 + 8 * bases.length);
    this.name = name;
    this.bases = Object.freeze([...bases]);
    this.namespace = namespace;
    this.mro = linearizeMro<RuntimeTypeLayout>(this, this.bases, base => base.mro, meter);
    Object.freeze(this);
  }
}

/** Resolve only the winning MRO value's descriptor slots. No namespace cache is
 * used: mutations remain visible without rebuilding immutable inheritance data.
 */
export function resolveRuntimeTypeAttribute(
  layout: RuntimeTypeLayout,
  name: Extract<RuntimeValue, { kind: "str" }>,
  context: RuntimeDescriptorContext,
  values: RuntimeValues,
  meter: ExecutionMeter
): { readonly owner: RuntimeTypeLayout; readonly attribute: ClassAttribute<RuntimeValue, RuntimeValue, RuntimeValue> } | undefined {
  const found = lookupMroAttribute(layout.mro, name, (owner, key) => owner.namespace.items.lookup(key), meter);
  if (found === undefined) return undefined;
  meter.checkpoint(1, 32);
  const attribute = resolveRuntimeClassAttribute(found.value, context, values, meter);
  meter.checkpoint();
  return Object.freeze({ owner: found.owner, attribute });
}
