import type { ExecutionMeter } from "./execution-budget.js";
import type { AttributeValue, ClassAttribute } from "./instance-attributes.js";

/** Search prevalidated MRO metadata without binding descriptors or caching mutable
 * namespaces. The callback searches only the supplied type's own namespace.
 */
export function lookupMroAttribute<Type, Name, Value>(
  mro: readonly Type[], name: Name,
  lookupOwn: (type: Type, name: Name) => AttributeValue<Value> | undefined,
  meter?: ExecutionMeter
): { readonly owner: Type; readonly value: Value } | undefined {
  meter?.checkpoint();
  for (const owner of mro) {
    meter?.checkpoint();
    const attribute = lookupOwn(owner, name);
    meter?.checkpoint();
    if (attribute !== undefined) return { owner, value: attribute.value };
  }
  return undefined;
}

/** Default type lookup with already-resolved metaclass descriptor slots. Class
 * lookup searches the class's MRO and resolves slots on the found value's type.
 * Overrides, __getattr__ and final missing-attribute diagnostics belong to callers.
 */
export function readClassAttribute<Instance, Value, Class, Metaclass>(
  cls: Class, metaclass: Metaclass,
  metaclassAttribute: ClassAttribute<Class, Value, Metaclass> | undefined,
  readClass: () => ClassAttribute<Instance, Value, Class> | undefined,
  meter?: ExecutionMeter
): AttributeValue<Value> | undefined {
  meter?.checkpoint();
  const slots = metaclassAttribute?.slots;
  if (slots?.get !== undefined && (slots.set !== undefined || slots.delete !== undefined)) {
    meter?.checkpoint();
    const value = slots.get(cls, metaclass);
    meter?.checkpoint();
    return { value };
  }
  meter?.checkpoint();
  const attribute = readClass();
  meter?.checkpoint();
  if (attribute !== undefined) {
    if (attribute.slots?.get !== undefined) {
      meter?.checkpoint();
      const value = attribute.slots.get(null, cls);
      meter?.checkpoint();
      return { value };
    }
    return { value: attribute.value };
  }
  if (slots?.get !== undefined) {
    meter?.checkpoint();
    const value = slots.get(cls, metaclass);
    meter?.checkpoint();
    return { value };
  }
  return metaclassAttribute === undefined ? undefined : { value: metaclassAttribute.value };
}
