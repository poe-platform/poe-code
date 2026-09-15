import type { ExecutionMeter } from "./execution-budget.js";
import type { AttributeValue, ClassAttribute } from "./instance-attributes.js";

/** Lookup for a validated, bound super proxy. Supply its current effective MRO,
 * effective owner (__self_class__), and null for class-bound descriptor access.
 * Namespace callbacks search only own bindings and resolve descriptor type slots.
 * Proxy attributes (including __class__), unbound proxies, constructor validation
 * and generic proxy fallback are responsibilities of the surrounding object layer.
 */
export function readSuperAttribute<Instance, Value, Owner, Name>(
  anchor: Owner, instance: Instance | null, owner: Owner,
  mro: readonly Owner[], name: Name,
  lookupOwn: (type: Owner, name: Name) => ClassAttribute<Instance, Value, Owner> | undefined,
  meter?: ExecutionMeter
): AttributeValue<Value> | undefined {
  meter?.checkpoint();
  let afterAnchor = false;
  for (const type of mro) {
    meter?.checkpoint();
    if (!afterAnchor) {
      if (type === anchor) afterAnchor = true;
      continue;
    }
    const attribute = lookupOwn(type, name);
    if (attribute === undefined) continue;
    if (attribute.slots?.get !== undefined) {
      meter?.checkpoint();
      return { value: attribute.slots.get(instance, owner) };
    }
    return { value: attribute.value };
  }
  return undefined;
}
